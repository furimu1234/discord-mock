import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { createBrowserFixture, textOf } from "./browser-fixture.ts";

const script = new Script(await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"));

const settle = async () => {
  for (let i = 0; i < 5; i++) await setImmediate();
};

test("/test のチャットは投稿と Bot 返信だけ、実行ステップと合否は別のログ欄に表示する", async () => {
  const fixture = createBrowserFixture("/test");
  const testCase = { id: "showLvl.test.ts:0", name: "投稿後にレベルを確認する" };
  const report = {
    id: "test-1",
    name: testCase.name,
    status: "running",
    step: "開始",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    steps: [{ text: "テスト用 Bot を起動", timestamp: "2026-01-01T00:00:00Z" }],
    guild: {
      name: "UT",
      channels: [
        { id: "general", name: "general", type: 0 },
        { id: "audit", name: "audit", type: 0 },
      ],
    },
    messages: {
      general: [] as Record<string, unknown>[],
      audit: [] as Record<string, unknown>[],
    },
  };
  let runs: Array<{ id: string }> = [];
  let selectedUserId = "123456789000000099";
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [];

  script.runInNewContext({
    ...fixture.globals,
    fetch: async (url: string, options: Record<string, unknown> = {}) => {
      calls.push({ url, options });
      if (url === "/_admin/session") return { ok: true, json: async () => ({ csrf: "admin-csrf" }) };
      if (url === "/_ui/session") return { ok: true, json: async () => ({
        csrf: "test-csrf", selectedUserId,
        users: [
          { id: "123456789000000099", username: "Alice", bot: false },
          { id: "123456789000000098", username: "Bob", bot: false },
        ],
      }) };
      if (url === "/_ui/identity") {
        selectedUserId = (JSON.parse(options.body as string) as { user_id: string }).user_id;
        return { ok: true, json: async () => ({ selectedUserId }) };
      }
      if (url === "/_admin/test-cases") return { ok: true, json: async () => ({ cases: [testCase], runningId: null, error: null }) };
      if (url === "/_ui/test-cases/run") return { ok: true, json: async () => ({ started: true }) };
      if (url === "/_admin/test-runs") return { ok: true, json: async () => ({ runs }) };
      if (url === "/_admin/test-runs/test-1") return { ok: true, json: async () => structuredClone(report) };
      throw new Error("Unexpected request: " + url);
    },
  });
  await settle();

  assert.equal(fixture.elements["manual-composer"].classes.has("hidden"), true);
  assert.equal(fixture.elements["test-case-composer"].classes.has("hidden"), false);
  assert.equal(fixture.elements["channel-sidebar"].classes.has("hidden"), false);
  assert.equal(fixture.elements["user-panel"].classes.has("hidden"), false);
  assert.equal(fixture.elements.identity.value, "123456789000000099");
  assert.equal(fixture.elements.identity.children.length, 2);
  fixture.elements.identity.value = "123456789000000098";
  fixture.elements.identity.onchange();
  await settle();
  const switchRequest = calls.find((call) => call.url === "/_ui/identity");
  assert.ok(switchRequest);
  assert.equal((switchRequest.options.headers as Record<string, string>)["x-discord-mock-csrf"], "test-csrf");
  assert.equal(selectedUserId, "123456789000000098");
  assert.equal(fixture.elements["test-log-panel"].classes.has("hidden"), false);
  assert.equal(fixture.elements["test-case-buttons"].children.length, 1);
  assert.equal(fixture.elements.channels.children.length, 1);
  assert.equal(fixture.elements["channel-title"].textContent, "# general");
  assert.match(textOf(fixture.elements.messages), /generalへようこそ/);
  assert.match(textOf(fixture.elements["test-log-entries"]), /まだ実行ログはありません/);
  assert.equal(calls.some((call) => call.url === "/_ui/state"), false);

  // ケースのボタンは CSRF 付き API に送信する。
  fixture.elements["test-case-buttons"].children[0].onclick();
  await settle();
  const start = calls.find((call) => call.url === "/_ui/test-cases/run");
  assert.ok(start);
  assert.equal((start.options.headers as Record<string, string>)["x-discord-mock-csrf"], "test-csrf");
  assert.deepEqual(JSON.parse(start.options.body as string), { id: testCase.id });

  runs = [{ id: report.id }];
  const stream = fixture.streams.find((s) => s.url === "/_admin/test-runs/events");
  assert.ok(stream);
  stream.handlers.get("changed")?.();
  await settle();
  assert.equal(fixture.elements.channels.children.length, 2);
  assert.match(textOf(fixture.elements["test-log-entries"]), /テスト用 Bot を起動/);
  assert.match(textOf(fixture.elements["test-log-entries"]), /実行中/);
  assert.doesNotMatch(textOf(fixture.elements.messages), /テスト用 Bot を起動/);
  assert.doesNotMatch(textOf(fixture.elements.messages), /投稿後にレベルを確認する/);

  report.status = "passed";
  report.steps.push({ text: "<script>検証完了</script>", timestamp: "2026-01-01T00:00:04Z" });
  report.messages.general.push(
    {
      id: "user1",
      channel_id: "general",
      author: { id: "alice", username: "Alice", bot: false },
      content: "こんにちは",
      timestamp: "2026-01-01T00:00:01Z",
    },
    {
      id: "bot1",
      channel_id: "general",
      author: { id: "bot", username: "MockBot", bot: true },
      content: "",
      timestamp: "2026-01-01T00:00:03Z",
      embeds: [{ type: "rich", title: "Alice | lvl", fields: [{ name: "今のレベルはこれだ", value: "7" }] }],
      interaction: { id: "interaction", type: 2, name: "レベル確認", user: { id: "alice", username: "Alice", bot: false } },
    },
  );
  report.messages.audit.push({
    id: "other1",
    channel_id: "audit",
    author: { id: "alice", username: "Alice", bot: false },
    content: "別チャンネルの投稿",
    timestamp: "2026-01-01T00:00:02Z",
  });
  stream.handlers.get("changed")?.();
  await settle();

  const chat = textOf(fixture.elements.messages);
  const log = textOf(fixture.elements["test-log-entries"]);
  assert.match(chat, /こんにちは/);
  assert.match(chat, /今のレベルはこれだ7/);
  assert.match(chat, /Aliceさんが\/レベル確認を使用しました/);
  assert.doesNotMatch(chat, /検証完了|結果: 成功|別チャンネルの投稿/);
  assert.match(log, /検証完了|成功/);
  assert.match(log, /<script>検証完了<\/script>/);
  assert.doesNotMatch(log, /今のレベルはこれだ7|こんにちは/);

  // サイドバーのチャンネル切替ではログは保持し、チャットだけ絞り込む。
  fixture.elements.channels.children[1].onclick();
  assert.equal(fixture.elements["channel-title"].textContent, "# audit");
  const auditChat = textOf(fixture.elements.messages);
  assert.match(auditChat, /別チャンネルの投稿/);
  assert.doesNotMatch(auditChat, /今のレベルはこれだ7|こんにちは/);
  assert.match(textOf(fixture.elements["test-log-entries"]), /成功/);

  report.status = "failed";
  report.steps.push({ text: "検証失敗", timestamp: "2026-01-01T00:00:05Z" });
  stream.handlers.get("changed")?.();
  await settle();
  assert.match(textOf(fixture.elements["test-log-entries"]), /結果: 失敗/);
  assert.doesNotMatch(textOf(fixture.elements.messages), /結果: 失敗/);
});

test("/test は起動直後に # general と空のチャンネル開始画面を表示する", async () => {
  const fixture = createBrowserFixture("/test");
  script.runInNewContext({
    ...fixture.globals,
    fetch: async (url: string) => {
      if (url === "/_admin/session") return { ok: true, json: async () => ({ csrf: "csrf" }) };
      if (url === "/_ui/session") return { ok: true, json: async () => ({
        csrf: "ui-csrf",
        selectedUserId: "123456789000000099",
        users: [{ id: "123456789000000099", username: "Alice", bot: false }],
      }) };
      if (url === "/_admin/test-cases") return { ok: true, json: async () => ({ cases: [], runningId: null, error: null }) };
      if (url === "/_admin/test-runs") return { ok: true, json: async () => ({ runs: [] }) };
      throw new Error(url);
    },
  });
  await settle();
  assert.equal(fixture.elements["channel-title"].textContent, "# general");
  assert.equal(fixture.elements.channels.children[0].textContent, "#  general");
  assert.match(textOf(fixture.elements.messages), /generalへようこそ/);
  assert.doesNotMatch(textOf(fixture.elements.messages), /実行待機中|結果:/);
  assert.match(textOf(fixture.elements["test-log-entries"]), /まだ実行ログはありません/);
});
