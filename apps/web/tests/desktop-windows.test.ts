import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { Script } from "node:vm";
import { test } from "node:test";
import { createBrowserFixture } from "./browser-fixture.ts";

const script = new Script(await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"));
async function settle() { for (let i = 0; i < 6; i++) await setImmediate(); }
async function open(supported = true) {
  const fixture = createBrowserFixture("/admin");
  const saved: unknown[] = [];
  const moved: unknown[] = [];
  const settings = {
    displays: [{ id: "1", label: "Main", primary: true, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    windows: { mock: { startupDisplay: "2" }, terminal: { startupDisplay: "primary" } },
    positionSupported: supported,
  };
  const bridge = {
    config: async () => ({ command: "node", args: [], cwd: "/local" }),
    discoveryDirectory: async () => "/local", discover: async () => [], saveConfig: async () => ({}),
    start: async () => ({}), stop: async () => ({}), restart: async () => ({}), status: async () => ({ running: false }),
    windowSettings: async () => settings,
    saveWindowSettings: async (value: unknown) => { saved.push(value); return settings; },
    moveWindow: async (id: string, display: string) => { moved.push([id, display]); if (display === "2") throw new Error("ディスプレイが接続されていません"); },
  };
  script.runInNewContext({ ...fixture.globals, window: { discordMockDesktop: bridge }, fetch: async (url: string) => ({
    ok: true, json: async () => url.endsWith("session") ? { authenticated: true, csrf: "admin" } : {
      guild: { name: "Mock", roles: [], channels: [] }, users: [], members: [],
    },
  }) });
  await settle();
  return { ...fixture, saved, moved };
}
test("desktop window settings keep disconnected startup displays and save each window separately", async () => {
  const { elements, saved, moved } = await open();
  const mock = elements["window-mock-display"];
  const terminal = elements["window-terminal-display"];
  assert.equal(mock.value, "2");
  assert.ok(mock.children.some(option => option.value === "2" && option.textContent.includes("未接続")));
  assert.equal(terminal.value, "primary");
  mock.value = "last"; terminal.value = "1";
  elements["window-settings-save"].onclick(); await settle();
  assert.equal(JSON.stringify(saved), '[{"mock":"last","terminal":"1"}]');
  terminal.value = "1";
  elements["window-terminal-move"].onclick(); await settle();
  assert.equal(JSON.stringify(moved), '[["terminal","1"]]');
});
test("desktop window movement errors are visible and controls recover", async () => {
  const { elements } = await open();
  elements["window-mock-move"].onclick(); await settle();
  assert.match(elements["window-settings-status"].textContent, /接続/);
  assert.equal(elements["window-settings-save"].disabled, false);
});
test("Wayland window settings explain position restrictions and disable moving", async () => {
  const { elements } = await open(false);
  assert.match(elements["window-position-note"].textContent, /Wayland/);
  assert.equal(elements["window-mock-move"].disabled, true);
  assert.equal(elements["window-terminal-move"].disabled, true);
});
