import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { initializeWindowFrame } from "../src/window-frame.ts";

class FrameElement extends EventTarget {
  dataset: { resize?: string };
  captures = new Set<number>();

  constructor(edge?: string) {
    super();
    this.dataset = edge ? { resize: edge } : {};
  }

  setPointerCapture(pointerId: number): void {
    this.captures.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captures.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captures.delete(pointerId);
  }
}

function frame(t: TestContext, connected = true) {
  const actions: string[] = [];
  const resize: unknown[][] = [];
  const controls = new Map(
    ["minimize", "maximize", "close"].map((action) => [
      `window-${action}`,
      new FrameElement(),
    ]),
  );
  const handles = new Map(
    ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((edge) => [
      edge,
      new FrameElement(edge),
    ]),
  );
  const host = Object.assign(new EventTarget(), {
    discordMockWindow: connected
      ? {
          action: async (action: string) => {
            actions.push(action);
          },
          resize: (...args: unknown[]) => {
            resize.push(args);
          },
        }
      : undefined,
  });
  const globals = {
    window: host,
    document: {
      getElementById: (id: string) => controls.get(id) ?? null,
      querySelectorAll: () => [...handles.values()],
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { actions, resize, controls, handles, host };
}

function pointer(
  target: EventTarget,
  type: string,
  values: Partial<{
    pointerId: number;
    isPrimary: boolean;
    button: number;
    buttons: number;
    screenX: number;
    screenY: number;
    clientX: number;
    clientY: number;
  }> = {},
): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, {
    pointerId: 7,
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    screenX: 400,
    screenY: 250,
    clientX: 20,
    clientY: 10,
    ...values,
  });
  target.dispatchEvent(event);
  return event;
}

function requiredHandle(handles: Map<string, FrameElement>, edge: string): FrameElement {
  const handle = handles.get(edge);
  assert.ok(handle);
  return handle;
}

test("タイトルバーのボタンは対応するウィンドウ操作を1回だけ送る", (t) => {
  const view = frame(t);
  initializeWindowFrame();
  initializeWindowFrame();
  for (const control of view.controls.values())
    control.dispatchEvent(new Event("click"));
  assert.deepEqual(view.actions, ["minimize", "maximize", "close"]);
});

for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
  test(`${edge}方向のリサイズは画面座標で追従し、解放時の最終位置で終了する`, (t) => {
    const view = frame(t);
    const handle = requiredHandle(view.handles, edge);
    initializeWindowFrame();
    const down = pointer(handle, "pointerdown", { screenX: -500 });
    assert.equal(down.defaultPrevented, true);
    assert.equal(handle.hasPointerCapture(7), true);
    pointer(view.host, "pointermove", {
      screenX: -480,
      screenY: 260,
      clientX: 1,
      clientY: 1,
    });
    pointer(view.host, "pointerup", { screenX: -470, screenY: 265 });
    pointer(view.host, "pointermove");
    assert.deepEqual(view.resize, [
      ["start", { edge, screenX: -500, screenY: 250 }],
      ["move", { screenX: -480, screenY: 260 }],
      ["move", { screenX: -470, screenY: 265 }],
      ["end"],
    ]);
    assert.equal(handle.hasPointerCapture(7), false);
  });
}

test("右ボタン・補助ポインター・未知の方向ではリサイズしない", (t) => {
  const view = frame(t);
  initializeWindowFrame();
  const handle = requiredHandle(view.handles, "e");
  pointer(handle, "pointerdown", { button: 2 });
  pointer(handle, "pointerdown", { isPrimary: false });
  handle.dataset.resize = "invalid";
  pointer(handle, "pointerdown");
  assert.deepEqual(view.resize, []);
  assert.equal(handle.hasPointerCapture(7), false);
});

test("操作中の別ポインターと二重開始を無視する", (t) => {
  const view = frame(t);
  initializeWindowFrame();
  pointer(requiredHandle(view.handles, "e"), "pointerdown");
  pointer(requiredHandle(view.handles, "n"), "pointerdown", { pointerId: 8 });
  pointer(view.host, "pointermove", { pointerId: 8, screenX: 800 });
  pointer(view.host, "pointerup", { pointerId: 8 });
  pointer(view.host, "pointerup");
  assert.deepEqual(view.resize, [
    ["start", { edge: "e", screenX: 400, screenY: 250 }],
    ["end"],
  ]);
});

for (const stop of ["pointercancel", "lostpointercapture", "blur", "pagehide"]) {
  test(`${stop}でリサイズとポインターキャプチャを1回だけ終了する`, (t) => {
    const view = frame(t);
    const handle = requiredHandle(view.handles, "nw");
    initializeWindowFrame();
    pointer(handle, "pointerdown");
    if (stop === "blur" || stop === "pagehide")
      view.host.dispatchEvent(new Event(stop));
    else pointer(view.host, stop);
    pointer(view.host, "lostpointercapture");
    pointer(view.host, "pointerup");
    assert.deepEqual(view.resize, [
      ["start", { edge: "nw", screenX: 400, screenY: 250 }],
      ["end"],
    ]);
    assert.equal(handle.hasPointerCapture(7), false);
  });
}

test("ボタン解放を検知した移動で終了し、その後の移動を送らない", (t) => {
  const view = frame(t);
  initializeWindowFrame();
  pointer(requiredHandle(view.handles, "s"), "pointerdown");
  pointer(view.host, "pointermove", { buttons: 0, screenY: 270 });
  pointer(view.host, "pointermove", { screenY: 300 });
  assert.deepEqual(view.resize, [
    ["start", { edge: "s", screenX: 400, screenY: 250 }],
    ["move", { screenX: 400, screenY: 270 }],
    ["end"],
  ]);
});

test("ブリッジのないブラウザではウィンドウ操作を登録しない", (t) => {
  const view = frame(t, false);
  initializeWindowFrame();
  for (const control of view.controls.values())
    control.dispatchEvent(new Event("click"));
  pointer(requiredHandle(view.handles, "n"), "pointerdown");
  assert.deepEqual(view.actions, []);
  assert.deepEqual(view.resize, []);
});
