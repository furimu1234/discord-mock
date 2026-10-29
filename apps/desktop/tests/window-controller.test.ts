import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WindowLayoutController } from "../src/window-controller.ts";
import { WindowStateStore } from "../src/window-state.ts";
import type { DisplayInfo, Rect } from "../src/window-types.ts";

class NativeWindow extends EventEmitter {
  bounds: Rect = { x: 100, y: 100, width: 900, height: 650 };
  maximized = false;
  minimized = false;
  destroyed = false;
  getBounds() { return { ...this.bounds }; }
  getNormalBounds() { return { ...this.bounds }; }
  getMinimumSize(): [number, number] { return [650, 450]; }
  setBounds(value: Rect) { this.bounds = { ...value }; this.emit("resize"); this.emit("move"); }
  isDestroyed() { return this.destroyed; }
  isMaximized() { return this.maximized; }
  isMinimized() { return this.minimized; }
  maximize() { this.maximized = true; this.emit("maximize"); }
  unmaximize() { this.maximized = false; this.emit("unmaximize"); }
  minimize() { this.minimized = true; this.maximized = false; this.emit("minimize"); }
  restore() { this.minimized = false; }
  show() { this.emit("show"); }
  focus() {}
  close() { this.emit("close"); this.destroyed = true; this.emit("closed"); }
}
const displays: DisplayInfo[] = [
  { id: "1", label: "Main", primary: true, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: "2", label: "Left", primary: false, scaleFactor: 1.5, workArea: { x: -1600, y: 0, width: 1600, height: 900 } },
];
async function fixture(t: { after(fn: () => Promise<void>): void }, supported = true) {
  const directory = await mkdtemp(join(tmpdir(), "dismock-window-controller-"));
  const store = new WindowStateStore(join(directory, "windows.json"));
  await store.load();
  let available = displays;
  const controller = new WindowLayoutController(store, {
    list: () => available,
    matching: bounds => available.find(display => bounds.x < 0 ? display.id === "2" : display.id === "1") ?? available[0],
  }, supported);
  t.after(async () => { await controller.flush(); await rm(directory, { recursive: true, force: true }); });
  return { controller, store, removeSecondary: () => { available = [displays[0]]; } };
}

test("window controller saves both windows independently and restores a display's previous bounds", async t => {
  const { controller, store } = await fixture(t);
  const mock = new NativeWindow();
  const terminal = new NativeWindow();
  controller.register("mock", mock);
  controller.register("terminal", terminal);
  mock.show(); terminal.show();
  await controller.flush();
  const mockBounds = { x: 80, y: 90, width: 980, height: 680 };
  mock.setBounds(mockBounds);
  terminal.setBounds({ x: 200, y: 300, width: 760, height: 500 });
  await controller.flush();
  await controller.move("mock", "2");
  mock.setBounds({ x: -1500, y: 60, width: 850, height: 600 });
  await controller.flush();
  await controller.move("mock", "1");
  assert.deepEqual(mock.bounds, mockBounds);
  await controller.save({ mock: "2", terminal: "primary" });
  assert.equal(controller.settings().windows.mock.startupDisplay, "2");
  assert.equal(store.snapshot().windows.mock.displays["2"].x, 100);
  assert.equal(store.snapshot().windows.terminal.displays["1"].width, 760);
  await assert.rejects(controller.move("mock", "999"), /接続/);
});

test("window controller validates resize messages and only resizes an active nonmaximized window", async t => {
  const { controller } = await fixture(t);
  const mock = new NativeWindow();
  controller.register("mock", mock);
  mock.show();
  await controller.flush();
  mock.setBounds({ x: 100, y: 100, width: 900, height: 650 });
  const before = mock.getBounds();
  controller.resize("mock", "move", { screenX: 999, screenY: 999 });
  controller.resize("mock", "start", { edge: "bad", screenX: 100, screenY: 100 });
  controller.resize("mock", "move", { screenX: Number.NaN, screenY: 0 });
  assert.deepEqual(mock.bounds, before);
  controller.resize("mock", "start", { edge: "nw", screenX: 100, screenY: 100 });
  controller.resize("mock", "move", { screenX: 140, screenY: 130 });
  assert.deepEqual(mock.bounds, { x: 140, y: 130, width: 860, height: 620 });
  controller.resize("mock", "end");
  controller.resize("mock", "move", { screenX: 300, screenY: 300 });
  assert.equal(mock.bounds.width, 860);
  controller.action("mock", "maximize");
  controller.resize("mock", "start", { edge: "e", screenX: 0, screenY: 0 });
  controller.resize("mock", "move", { screenX: 100, screenY: 0 });
  assert.equal(mock.bounds.width, 860);
  assert.throws(() => controller.action("mock", "launch-command"), /操作/);
});

test("window controller relocates a disconnected window into an available work area", async t => {
  const { controller, removeSecondary } = await fixture(t);
  const mock = new NativeWindow();
  controller.register("mock", mock);
  mock.show();
  await controller.move("mock", "2");
  removeSecondary();
  await controller.reconcile();
  assert.ok(mock.bounds.x >= 0);
  assert.ok(mock.bounds.x + mock.bounds.width <= 1920);
});

test("Wayland restrictions preserve saved geometry and explain unsupported movement", async t => {
  const { controller, store } = await fixture(t, false);
  const mock = new NativeWindow();
  controller.register("mock", mock);
  mock.show();
  mock.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  await controller.flush();
  assert.deepEqual(store.snapshot().windows.mock.displays, {});
  assert.equal(controller.settings().positionSupported, false);
  await assert.rejects(controller.move("mock", "1"), /Wayland/);
});

test("minimizing a maximized window preserves its maximized startup state", async t => {
  const { controller, store } = await fixture(t);
  const mock = new NativeWindow();
  controller.register("mock", mock);
  mock.show();
  await controller.flush();
  mock.maximize();
  mock.minimize();
  await controller.flush();
  assert.equal(store.snapshot().windows.mock.displays["1"].maximized, true);
});

test("a transient disk error does not prevent subsequent window saves", async t => {
  const directory = await mkdtemp(join(tmpdir(), "dismock-window-retry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "layout.json");
  const store = new WindowStateStore(file);
  await store.load();
  await mkdir(file);
  const controller = new WindowLayoutController(store, { list: () => displays, matching: () => displays[0] }, true);
  const mock = new NativeWindow();
  controller.register("mock", mock);
  mock.show();
  await assert.rejects(controller.flush());
  await rm(file, { recursive: true });
  mock.setBounds({ x: 50, y: 60, width: 800, height: 600 });
  await controller.flush();
  const reloaded = new WindowStateStore(file);
  await reloaded.load();
  assert.equal(reloaded.snapshot().windows.mock.displays["1"].width, 800);
});

test("saved maximization waits until content is ready and the window is first shown", async t => {
  const { controller, store } = await fixture(t);
  await store.record("mock", displays[0], { x: 100, y: 100, width: 900, height: 650 }, true);
  const mock = new NativeWindow();
  controller.register("mock", mock);
  assert.equal(mock.isMaximized(), false);
  mock.show();
  await controller.flush();
  assert.equal(mock.isMaximized(), true);
});

test("hidden windows cannot overwrite saved geometry before their first display", async t => {
  const { controller, store } = await fixture(t);
  const previous = { x: -1500, y: 100, width: 800, height: 600 };
  await store.record("mock", displays[1], previous, false);
  const mock = new NativeWindow();
  controller.register("mock", mock);
  mock.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  await controller.flush();
  assert.equal(store.snapshot().windows.mock.lastDisplayId, "2");
  mock.show();
  await controller.flush();
  assert.deepEqual(mock.getBounds(), previous);
});
