import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { createBrowserFixture } from "./browser-fixture.ts";

const script = new Script(
  await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"),
);
interface Config {
  command: string;
  args: string[];
  cwd: string;
  runtime?: "test-client";
}
const detected = {
  file: "custom-name.ts",
  config: {
    command: "node",
    args: ["/tools/tsx/cli.mjs", "/application/custom-name.ts"],
    cwd: "/application",
    runtime: "test-client" as const,
  },
};
async function settle() {
  for (let index = 0; index < 5; index++) await setImmediate();
}
async function openSettings(results: Array<{ file: string; config: Config }> = [detected], fail = false) {
  const fixture = createBrowserFixture("/admin");
  const calls: string[] = [];
  let saved: Config = { command: "node", args: [], cwd: "/manual" };
  const bridge = {
    config: async () => saved,
    discoveryDirectory: async () => {
      calls.push("directory");
      return "/application";
    },
    discover: async () => {
      calls.push("discover");
      if (fail) throw new Error("読み取れません");
      return results;
    },
    saveConfig: async (value: Config) => {
      calls.push("save");
      saved = value;
      return value;
    },
    status: async () => ({ running: false }),
    start: async () => {
      calls.push("start");
      return { running: true };
    },
    stop: async () => {
      calls.push("stop");
      return { running: false };
    },
    restart: async () => {
      calls.push("restart");
      return { running: true };
    },
  };
  script.runInNewContext({
    ...fixture.globals,
    window: { discordMockDesktop: bridge },
    fetch: async (url: string) => {
      if (url === "/_admin/ui/session")
        return {
          ok: true,
          json: async () => ({ authenticated: true, csrf: "admin-only" }),
        };
      assert.equal(url, "/_admin/ui/state");
      return {
        ok: true,
        json: async () => ({
          guild: { name: "Mock", roles: [], channels: [] },
          users: [],
          members: [],
        }),
      };
    },
  });
  await settle();
  return { ...fixture, calls, saved: () => saved };
}

test("確認前・キャンセル時はファイルを取得せず、確認後に設定だけを入力する", async () => {
  const fixture = await openSettings();
  const { elements, calls } = fixture;
  assert.deepEqual(calls, []);
  elements["desktop-detect"].onclick();
  await settle();
  assert.deepEqual(calls, ["directory"]);
  assert.equal(elements["desktop-detect-dialog"].open, true);
  assert.match(
    elements["desktop-detect-directory"].textContent,
    /\/application/,
  );
  elements["desktop-detect-cancel"].onclick();
  assert.equal(elements["desktop-detect-dialog"].open, false);
  assert.deepEqual(calls, ["directory"]);
  elements["desktop-detect"].onclick();
  await settle();
  elements["desktop-detect-confirm"].onclick();
  await settle();
  assert.equal(elements["desktop-detect-dialog"].open, false);
  assert.equal(elements["desktop-command"].value, detected.config.command);
  assert.deepEqual(
    JSON.parse(elements["desktop-args"].value),
    detected.config.args,
  );
  assert.equal(elements["desktop-cwd"].value, detected.config.cwd);
  assert.equal(fixture.saved().command, "node");
  assert.equal(calls.includes("save"), false);
  assert.equal(calls.includes("start"), false);
  elements["desktop-start"].onclick();
  await settle();
  assert.deepEqual(calls.slice(-2), ["save", "start"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(fixture.saved())),
    detected.config,
  );
  elements["desktop-restart"].onclick();
  await settle();
  assert.deepEqual(calls.slice(-2), ["save", "restart"]);
  elements["desktop-stop"].onclick();
  await settle();
  assert.deepEqual(calls.slice(-2), ["restart", "stop"]);
});

test("候補が複数なら選択まで設定を維持し、ゼロ件・取得失敗でも入力を壊さない", async () => {
  const second = {
    file: "second.js",
    config: {
      command: "/runtime/node",
      args: ["/application/second.js"],
      cwd: "/application",
    },
  };
  const fixture = await openSettings([detected, second]);
  fixture.elements["desktop-detect"].onclick();
  await settle();
  fixture.elements["desktop-detect-confirm"].onclick();
  await settle();
  assert.equal(fixture.elements["desktop-command"].value, "node");
  assert.equal(
    fixture.elements["desktop-candidate-field"].classes.has("hidden"),
    false,
  );
  fixture.elements["desktop-candidates"].value = "1";
  fixture.elements["desktop-candidates"].onchange();
  assert.deepEqual(
    JSON.parse(fixture.elements["desktop-args"].value),
    second.config.args,
  );
  for (const fail of [false, true]) {
    const empty = await openSettings([], fail);
    empty.elements["desktop-detect"].onclick();
    await settle();
    empty.elements["desktop-detect-confirm"].onclick();
    await settle();
    assert.equal(empty.elements["desktop-command"].value, "node");
    assert.equal(empty.elements["desktop-detect"].disabled, false);
    assert.match(
      empty.elements["desktop-detection-status"].textContent,
      fail ? /読み取れません/ : /見つかりません/,
    );
    assert.equal(empty.calls.includes("start"), false);
  }
});
