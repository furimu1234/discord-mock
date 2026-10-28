import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { createBrowserFixture, textOf } from "./browser-fixture.ts";

const script = new Script(await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"));

test("/test のチャットへテストケース・操作・Bot 返信・成功失敗を反映する", async () => {
  const fixture = createBrowserFixture("/test");
  const caseItem = { id: "showLvl.test.ts:0", name: "投稿したあとにコマンドでレベルを確認できる" };
  const report = {
    id: "test-1",
    name: caseItem.name,
    status: "running",
    step: "メッセージ送信",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    steps: [{ text: "Alice がメッセージを送信", timestamp: "2026-01-01T00:00:00Z" }],
    guild: { name: "UT", channels: [{ id: "general", name: "general", type: 0 }] },
    messages: { general: [] as Record<string, unknown>[] },
  };
  let runs: Array<{ id: string }> = [];
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
  script.runInNewContext({
    ...fixture.globals,
    fetch: async (url: string, options: Record<string, unknown> = {}) => {
      calls.push({ url, options });
      if (url === "/_admin/session") return { ok: true, json: async () => ({ csrf: "test-csrf" }) };
      if (url === "/_admin/test-cases") return {
        ok: true,
        json: async () => ({ cases: [caseItem], runningId: null, error: null }),
      };
      if (url === "/_admin/test-cases/run") return { ok: true, json: async () => ({ started: true }) };
      if (url === "/_admin/test-runs") return { ok: true, json: async () => ({ runs }) };
      if (url === "/_admin/test-runs/test-1") return { ok: true, json: async () => structuredClone(report) };
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  for (let i = 0; i < 4; i++) await setImmediate();
  assert.equal(fixture.elements["test-case-buttons"].children.length, 1);
  assert.equal(fixture.elements["manual-composer"].classes.has("hidden"), true);
  assert.equal(fixture.elements["test-case-composer"].classes.has("hidden"), false);
  assert.equal(calls.some((call) => call.url === "/_ui/state"), false);

  fixture.elements["test-case-buttons"].children[0].onclick();
  await setImmediate();
  await setImmediate();
  const start = calls.find((call) => call.url === "/_admin/test-cases/run");
  assert.ok(start);
  assert.equal((start.options.headers as Record<string, string>)["x-discord-mock-admin-csrf"], "test-csrf");
  assert.deepEqual(JSON.parse(start.options.body as string), { id: caseItem.id });

  runs = [{ id: report.id }];
  const sse = fixture.streams.find((stream) => stream.url === "/_admin/test-runs/events");
  assert.ok(sse);
  sse.handlers.get("changed")?.();
  for (let i = 0; i < 3; i++) await setImmediate();
  assert.match(textOf(fixture.elements.messages), /Alice がメッセージを送信/);
  assert.match(textOf(fixture.elements.messages), /実行中/);

  report.status = "passed";
  report.steps.push({ text: "<script>検証完了</script>", timestamp: "2026-01-01T00:00:01Z" });
  report.messages.general.push({
    id: "msg-1",
    channel_id: "general",
    author: { id: "bot", username: "MockBot", bot: true },
    content: "",
    timestamp: "2026-01-01T00:00:00Z",
    embeds: [{ type: "rich", title: "Alice | lvl", fields: [{ name: "今のレベルはこれだ", value: "7" }] }],
    interaction: { id: "1", type: 2, name: "レベル確認", user: { id: "alice", username: "Alice", bot: false } },
  });
  sse.handlers.get("changed")?.();
  for (let i = 0; i < 3; i++) await setImmediate();
  assert.match(textOf(fixture.elements.messages), /今のレベルはこれだ7/);
  assert.match(textOf(fixture.elements.messages), /成功/);
  assert.match(textOf(fixture.elements.messages), /<script>検証完了<\/script>/);

  report.status = "failed";
  report.steps.push({ text: "検証失敗", timestamp: "2026-01-01T00:00:02Z" });
  sse.handlers.get("changed")?.();
  for (let i = 0; i < 3; i++) await setImmediate();
  assert.match(textOf(fixture.elements.messages), /結果: 失敗/);
});

test("/test は前回の結果がなければ空の実行ログを表示する", async () => {
  const fixture = createBrowserFixture("/test");
  script.runInNewContext({
    ...fixture.globals,
    fetch: async (url: string) => {
      if (url === "/_admin/session") return { ok: true, json: async () => ({ csrf: "csrf" }) };
      if (url === "/_admin/test-cases") return { ok: true, json: async () => ({ cases: [], runningId: null, error: null }) };
      if (url === "/_admin/test-runs") return { ok: true, json: async () => ({ runs: [] }) };
      throw new Error(url);
    },
  });
  for (let i = 0; i < 4; i++) await setImmediate();
  assert.match(textOf(fixture.elements.messages), /実行待機中/);
});
