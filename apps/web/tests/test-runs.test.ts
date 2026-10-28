import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { createBrowserFixture, textOf } from "./browser-fixture.ts";

const script = new Script(
  await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"),
);

test("自動テストの状況・コマンド返信を SSE で更新し、結果を安全に表示する", async () => {
  const fixture = createBrowserFixture("/tests");
  const run = {
    id: "run-1",
    name: "レベル確認",
    status: "running",
    step: "コマンド実行",
    steps: [{ text: "コマンド実行", timestamp: "2026-01-01T00:00:00Z" }] as Array<{text: string; timestamp?: string}>,
    guild: {
      name: "UT",
      channels: [{ id: "general", name: "general", type: 0 }],
    },
    messages: { general: [] as Array<Record<string, unknown>> },
  };
  const urls = [];
  script.runInNewContext({
    ...fixture.globals,
    fetch: async (url, options = {}) => {
      urls.push(url);
      if (url === "/_admin/session") {
        assert.equal(options.headers["x-discord-mock-local"], "1");
        return { ok: true, json: async () => ({ authenticated: true }) };
      }
      if (url === "/_admin/test-runs")
        return { ok: true, json: async () => ({ runs: [run] }) };
      assert.equal(url, "/_admin/test-runs/run-1");
      return { ok: true, json: async () => structuredClone(run) };
    },
  });
  await setImmediate();
  assert.equal(fixture.elements["tests-panel"].classes.has("hidden"), false);
  assert.equal(fixture.elements["test-panel"].classes.has("hidden"), true);
  assert.equal(fixture.elements["test-run-status"].textContent, "実行中");
  assert.equal(fixture.streams[0].url, "/_admin/test-runs/events");
  assert.equal(
    urls.some((url) => url.startsWith("/_ui/")),
    false,
  );
  run.status = "passed";
  run.steps.push({ text: "<script>検証完了</script>" });
  run.messages.general.push({
    author: { username: "MockBot", bot: true },
    content: "",
    timestamp: "2026-01-01T00:00:00Z",
    embeds: [
      {
        type: "rich",
        title: "Alice | lvl",
        fields: [{ name: "今のレベルはこれだ", value: "7" }],
        footer: { text: "by alice" },
      },
    ],
    interaction: {
      id: "1",
      type: 2,
      name: "レベル確認",
      user: { username: "Alice" },
    },
  });
  fixture.streams[0].handlers.get("changed")();
  await setImmediate();
  assert.equal(fixture.elements["test-run-status"].textContent, "成功");
  assert.match(
    textOf(fixture.elements["test-run-messages"]),
    /Aliceさんが\/レベル確認を使用しました/,
  );
  assert.match(
    textOf(fixture.elements["test-run-messages"]),
    /今のレベルはこれだ7/,
  );
  assert.equal(
    fixture.elements["test-run-steps"].children[1].textContent,
    "<script>検証完了</script>",
  );
});
