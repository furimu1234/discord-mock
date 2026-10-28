import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { createBrowserFixture, textOf } from "./browser-fixture.ts";

const compiled = new Script(await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"));

test("/test を開いたまま UT の実行内容・返信・成功と失敗を SSE で反映する", async () => {
  const fixture = createBrowserFixture("/test");
  const live = {
    guild: { name: "通常の Guild", channels: [{ id: "general", name: "general", type: 0 }] },
    users: [{ id: "alice", username: "Alice", bot: false }],
    selectedUserId: "alice",
    botConnections: 0,
    messages: { general: [] },
    commands: [],
  };
  const run = {
    id: "run-1",
    name: "レベル確認の UT",
    status: "running",
    step: "/レベル確認 を実行",
    steps: [{ text: "/レベル確認 を実行", timestamp: "2026-01-01T00:00:00Z" }],
    guild: { name: "UT", channels: [{ id: "general", name: "general", type: 0 }] },
    messages: { general: [] as Record<string, unknown>[] },
  };
  let summaries: Array<{ id: string; name: string; status: string }> = [];
  const requested: string[] = [];
  compiled.runInNewContext({
    ...fixture.globals,
    fetch: async (url: string, options: { headers?: Record<string, string> } = {}) => {
      requested.push(url);
      if (url === "/_ui/session") return { ok: true, json: async () => ({ csrf: "csrf", selectedUserId: "alice" }) };
      if (url === "/_ui/state") return { ok: true, json: async () => live };
      if (url === "/_admin/session") {
        assert.equal(options.headers?.["x-discord-mock-local"], "1");
        return { ok: true, json: async () => ({ authenticated: true }) };
      }
      if (url === "/_admin/test-runs") return { ok: true, json: async () => ({ runs: summaries }) };
      if (url === "/_admin/test-runs/run-1") return { ok: true, json: async () => structuredClone(run) };
      throw new Error(`予期しないリクエスト: ${url}`);
    },
  });
  await setImmediate();
  await setImmediate();
  assert.equal(fixture.elements["test-preview"].classes.has("hidden"), true);
  const sse = fixture.streams.find((stream) => stream.url === "/_admin/test-runs/events");
  assert.ok(sse, "開いている /test が UT の更新を購読する");

  summaries = [{ id: run.id, name: run.name, status: run.status }];
  sse.handlers.get("changed")?.();
  await setImmediate();
  await setImmediate();
  assert.equal(fixture.elements["test-preview"].classes.has("hidden"), false);
  assert.equal(fixture.elements["test-preview-status"].textContent, "実行中");
  assert.equal(fixture.elements["test-preview-title"].textContent, run.name);
  assert.match(textOf(fixture.elements["test-preview-steps"]), /レベル確認/);

  run.status = "passed";
  run.steps.push({ text: "検証完了", timestamp: "2026-01-01T00:00:01Z" });
  run.messages.general.push({
    id: "msg1",
    content: "",
    author: { id: "bot", username: "MockBot", bot: true },
    timestamp: "2026-01-01T00:00:00Z",
    embeds: [{ type: "rich", title: "Alice | lvl", fields: [{ name: "今のレベルはこれだ", value: "7" }] }],
    interaction: { id: "1", type: 2, name: "レベル確認", user: { id: "alice", username: "Alice", bot: false } },
  });
  sse.handlers.get("changed")?.();
  await setImmediate();
  await setImmediate();
  assert.equal(fixture.elements["test-preview-status"].textContent, "成功");
  assert.match(textOf(fixture.elements["test-preview-steps"]), /検証完了/);
  assert.match(textOf(fixture.elements["test-preview-messages"]), /レベル確認/);
  assert.match(textOf(fixture.elements["test-preview-messages"]), /今のレベルはこれだ7/);
  assert.equal(fixture.elements.messages.children.length, 2, "通常のチャットに UT のメッセージを混ぜない");
  assert.equal(live.messages.general.length, 0);
  assert.equal(requested.filter((url) => url === "/_ui/state").length, 1);

  run.status = "failed";
  run.steps.push({ text: "<script>検証失敗</script>", timestamp: "2026-01-01T00:00:02Z" });
  sse.handlers.get("changed")?.();
  await setImmediate();
  await setImmediate();
  assert.equal(fixture.elements["test-preview-status"].textContent, "失敗");
  assert.equal(fixture.elements["test-preview-steps"].children.at(-1)?.textContent, "<script>検証失敗</script>");
});
