import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { restorePlacement, resizeBounds, WindowStateStore } from "../src/window-state.ts";
import type { DisplayInfo, Rect, ResizeEdge, WindowLayoutData } from "../src/window-types.ts";

const primary: DisplayInfo = {
  id: "1", label: "主画面", workArea: { x: 0, y: 32, width: 1920, height: 1048 },
  scaleFactor: 1, primary: true,
};
const left: DisplayInfo = {
  id: "2", label: "左の画面", workArea: { x: -1600, y: -120, width: 1600, height: 900 },
  scaleFactor: 1.25, primary: false,
};

function defaults(): WindowLayoutData {
  return {
    version: 1,
    windows: {
      mock: { startupDisplay: "last", displays: {} },
      terminal: { startupDisplay: "last", displays: {} },
    },
  };
}

async function temporaryStore(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "discord-mock-window-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "window-layout.json");
  const store = new WindowStateStore(file);
  await store.load();
  return { dir, file, store };
}

test("未保存のウィンドウは指定画面の作業領域に収まる大きさで中央に開く", () => {
  const data = defaults();
  assert.deepEqual(restorePlacement("mock", [primary, left], data), {
    displayId: "1", bounds: { x: 335, y: 131, width: 1250, height: 850 }, maximized: false,
  });
  data.windows.terminal.startupDisplay = "2";
  assert.deepEqual(restorePlacement("terminal", [primary, left], data), {
    displayId: "2", bounds: { x: -1330, y: -20, width: 1060, height: 700 }, maximized: false,
  });
  const small = { ...primary, workArea: { x: 20, y: 40, width: 640, height: 480 } };
  assert.deepEqual(restorePlacement("mock", [small], data).bounds, small.workArea);
});

test("Mockとターミナルは2画面それぞれの位置・サイズ・最大化を独立して復元する", async (t) => {
  const { store } = await temporaryStore(t);
  await store.record("mock", primary, { x: 100, y: 132, width: 1200, height: 800 }, false);
  await store.record("terminal", primary, { x: 200, y: 232, width: 900, height: 600 }, true);
  await store.record("mock", left, { x: -1500, y: -70, width: 1300, height: 750 }, true);
  await store.record("terminal", left, { x: -1400, y: 30, width: 1000, height: 550 }, false);
  await store.setStartupDisplays({ mock: "1", terminal: "2" });
  assert.deepEqual(restorePlacement("mock", [primary, left], store.snapshot()), {
    displayId: "1", bounds: { x: 100, y: 132, width: 1200, height: 800 }, maximized: false,
  });
  assert.deepEqual(restorePlacement("terminal", [primary, left], store.snapshot()), {
    displayId: "2", bounds: { x: -1400, y: 30, width: 1000, height: 550 }, maximized: false,
  });
  assert.deepEqual(store.snapshot().windows.mock.displays["2"], {
    x: 100, y: 50, width: 1300, height: 750, maximized: true,
  });
});

test("切断した指定画面は最後の画面と主画面へ退避し、再接続すると履歴を復元する", async (t) => {
  const { store } = await temporaryStore(t);
  await store.record("mock", left, { x: -1450, y: -20, width: 1100, height: 650 }, true);
  await store.setStartupDisplays({ mock: "2", terminal: "last" });
  assert.equal(restorePlacement("mock", [primary], store.snapshot()).displayId, "1");
  await store.record("mock", primary, { x: 60, y: 92, width: 1000, height: 700 }, false);
  assert.deepEqual(restorePlacement("mock", [primary, left], store.snapshot()), {
    displayId: "2", bounds: { x: -1450, y: -20, width: 1100, height: 650 }, maximized: true,
  });
  await store.setStartupDisplays({ mock: "999", terminal: "primary" });
  assert.equal(restorePlacement("mock", [primary, left], store.snapshot()).displayId, "1");
  await store.record("mock", left, { x: -1450, y: -20, width: 1100, height: 650 }, false);
  assert.equal(restorePlacement("mock", [primary, left], store.snapshot()).displayId, "2");
  assert.equal(restorePlacement("terminal", [left, primary], store.snapshot()).displayId, "1");
});

test("画面の原点・作業領域・拡大率が変わってもDIPの相対位置を使い領域内へ補正する", () => {
  const data = defaults();
  data.windows.mock.lastDisplayId = "2";
  data.windows.mock.displays["2"] = { x: 1000, y: -80, width: 1300, height: 950, maximized: true };
  const changed = { ...left, scaleFactor: 2, workArea: { x: -1280, y: 40, width: 1280, height: 720 } };
  assert.deepEqual(restorePlacement("mock", [primary, changed], data), {
    displayId: "2", bounds: { x: -1280, y: 40, width: 1280, height: 720 }, maximized: true,
  });
  data.windows.mock.displays["2"] = { x: 1100, y: 700, width: 600, height: 400, maximized: false };
  assert.deepEqual(restorePlacement("mock", [changed], data).bounds, {
    x: -600, y: 360, width: 600, height: 400,
  });
  data.windows.mock.displays["2"] = { x: 50, y: 60, width: 600, height: 400, maximized: false };
  assert.deepEqual(restorePlacement("mock", [changed], data).bounds, {
    x: -1230, y: 100, width: 600, height: 400,
  });
  assert.throws(() => restorePlacement("mock", [], data), /display|画面/i);
});

test("8方向のリサイズは反対側の辺を保持する", () => {
  const start = { x: -100, y: 20, width: 800, height: 600 };
  const cases: { edge: ResizeEdge; want: Rect }[] = [
    { edge: "n", want: { x: -100, y: 50, width: 800, height: 570 } },
    { edge: "ne", want: { x: -100, y: 50, width: 850, height: 570 } },
    { edge: "e", want: { x: -100, y: 20, width: 850, height: 600 } },
    { edge: "se", want: { x: -100, y: 20, width: 850, height: 630 } },
    { edge: "s", want: { x: -100, y: 20, width: 800, height: 630 } },
    { edge: "sw", want: { x: -50, y: 20, width: 750, height: 630 } },
    { edge: "w", want: { x: -50, y: 20, width: 750, height: 600 } },
    { edge: "nw", want: { x: -50, y: 50, width: 750, height: 570 } },
  ];
  for (const { edge, want } of cases) {
    assert.deepEqual(resizeBounds(start, edge, 50, 30, { width: 400, height: 300 }), want, edge);
  }
  assert.deepEqual(start, { x: -100, y: 20, width: 800, height: 600 });
});

test("最小サイズを越えてドラッグしても辺を反転させず反対側の辺を保持する", () => {
  const start = { x: 100, y: 200, width: 800, height: 600 };
  assert.deepEqual(resizeBounds(start, "nw", 2000, 2000, { width: 500, height: 400 }), {
    x: 400, y: 400, width: 500, height: 400,
  });
  assert.deepEqual(resizeBounds(start, "se", -2000, -2000, { width: 500, height: 400 }), {
    x: 100, y: 200, width: 500, height: 400,
  });
  assert.throws(() => resizeBounds(start, "e", Number.NaN, 0, { width: 500, height: 400 }));
  assert.throws(() => resizeBounds(start, "x" as ResizeEdge, 0, 0, { width: 500, height: 400 }));
});

test("同時保存を直列化し、正常終了時のflush後に全変更を再読込できる", async (t) => {
  const { file, store, dir } = await temporaryStore(t);
  const writes: Promise<void>[] = [];
  for (let index = 0; index < 20; index++) {
    writes.push(store.record("mock", primary, { x: index, y: 52, width: 1000, height: 700 }, false));
    writes.push(store.record("terminal", left, { x: -1500, y: index, width: 900, height: 500 }, true));
  }
  writes.push(store.setStartupDisplays({ mock: "primary", terminal: "2" }));
  await Promise.all(writes);
  await store.flush();
  const reloaded = new WindowStateStore(file);
  await reloaded.load();
  assert.deepEqual(reloaded.snapshot(), store.snapshot());
  assert.equal(reloaded.snapshot().windows.mock.displays["1"].x, 19);
  assert.equal(reloaded.snapshot().windows.terminal.displays["2"].y, 139);
  assert.equal(reloaded.snapshot().windows.mock.startupDisplay, "primary");
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(dir)).isDirectory(), true);
  const snapshot = store.snapshot();
  snapshot.windows.mock.displays["1"].x = 999;
  snapshot.windows.mock.startupDisplay = "999";
  assert.equal(store.snapshot().windows.mock.displays["1"].x, 19);
  assert.equal(store.snapshot().windows.mock.startupDisplay, "primary");
});

test("壊れたJSON・スキーマ・versionは上書きせずに拒否する", async (t) => {
  const { file } = await temporaryStore(t);
  const badValues = [
    "{ broken",
    "null",
    JSON.stringify({ ...defaults(), version: 2 }),
    JSON.stringify({ ...defaults(), unexpected: true }),
    JSON.stringify({ version: 1, windows: { mock: defaults().windows.mock } }),
    '{"version":1,"windows":{"mock":{"startupDisplay":"last","displays":{"__proto__":{"x":0,"y":0,"width":10,"height":10,"maximized":false}}},"terminal":{"startupDisplay":"last","displays":{}}}}',
  ];
  for (const original of badValues) {
    await writeFile(file, original);
    const store = new WindowStateStore(file);
    await assert.rejects(store.load());
    await assert.rejects(store.setStartupDisplays({ mock: "last", terminal: "last" }));
    await assert.rejects(store.flush());
    assert.equal(await readFile(file, "utf8"), original);
  }
});

test("保存済み位置の型・有限数・サイズ・IDを検証する", async (t) => {
  const { file } = await temporaryStore(t);
  const good = { x: 0, y: 0, width: 1000, height: 600, maximized: false };
  const placements = [
    { ...good, width: 0 }, { ...good, height: -1 }, { ...good, x: "10" },
    { ...good, x: 1e99 }, { ...good, maximized: 1 }, { ...good, extra: true },
  ];
  for (const placement of placements) {
    const data = defaults() as unknown as { windows: { mock: { displays: Record<string, unknown> } } };
    data.windows.mock.displays["1"] = placement;
    const original = JSON.stringify(data);
    await writeFile(file, original);
    await assert.rejects(new WindowStateStore(file).load());
    assert.equal(await readFile(file, "utf8"), original);
  }
  const nonfinite = JSON.stringify({ ...defaults(), extra: false }).replace('"extra":false', '"extra":1e999');
  await writeFile(file, nonfinite);
  await assert.rejects(new WindowStateStore(file).load());
});

test("起動先設定は両ウィンドウだけの完全な入力と整数画面IDを要求する", async (t) => {
  const { store } = await temporaryStore(t);
  const original = store.snapshot();
  for (const value of [
    null, [], {}, { mock: "last" }, { mock: "last", terminal: "last", extra: true },
    { mock: "last", terminal: 2 }, { mock: "last", terminal: "" },
    { mock: "last", terminal: "__proto__" }, { mock: "last", terminal: "1.5" },
    { mock: "last", terminal: "01" }, { mock: "last", terminal: "9007199254740992" },
  ]) {
    await assert.rejects(store.setStartupDisplays(value));
    assert.deepEqual(store.snapshot(), original);
  }
  await store.setStartupDisplays({ mock: "-1", terminal: "0" });
  assert.equal(store.snapshot().windows.mock.startupDisplay, "-1");
  assert.equal(store.snapshot().windows.terminal.startupDisplay, "0");
});

test("入力に問題がある記録は保存済みの状態を変更しない", async (t) => {
  const { store } = await temporaryStore(t);
  const bounds = { x: 100, y: 100, width: 1000, height: 700 };
  await store.record("mock", primary, bounds, false);
  const original = store.snapshot();
  await assert.rejects(store.record("other" as "mock", primary, bounds, false));
  await assert.rejects(store.record("mock", { ...primary, id: "constructor" }, bounds, false));
  await assert.rejects(store.record("mock", primary, { ...bounds, width: Number.POSITIVE_INFINITY }, false));
  await assert.rejects(store.record("mock", primary, bounds, "yes" as unknown as boolean));
  assert.deepEqual(store.snapshot(), original);
});
