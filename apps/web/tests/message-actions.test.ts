import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Script } from "node:vm";
import { createBrowserFixture, textOf } from "./browser-fixture.ts";

const script = new Script(
  await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"),
);
const settle = async () => {
  for (let i = 0; i < 6; i++) await setImmediate();
};
const channel = "123456789000000002";
const otherChannel = "123456789000000003";
const messageId = "123456789000005000";
const runId = "11111111-1111-4111-8111-111111111111";
const newerRunId = "22222222-2222-4222-8222-222222222222";

async function openChat(hash = "", globals: Record<string, unknown> = {}) {
  const fixture = createBrowserFixture("/test");
  fixture.globals.location.hash = hash;
  let userId = "alice";
  const message = (
    id: string,
    channel_id: string,
    content: string,
    timestamp: string,
  ) => ({
    id,
    channel_id,
    content,
    timestamp,
    author: { id: "alice", username: "Alice", bot: false },
    canEdit: true,
    canDelete: true,
    embeds: [],
  });
  const first = message(
    messageId,
    channel,
    "同じIDの古い実行",
    "2026-01-01T00:00:02Z",
  );
  const earliest = message(
    "123456789000005001",
    otherChannel,
    "この実行の最初の投稿",
    "2026-01-01T00:00:01Z",
  );
  const run = (id: string, messages) => ({
    id,
    name: id === runId ? "古い実行" : "新しい実行",
    status: "passed",
    steps: [],
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:03Z",
    guild: {
      name: "UT",
      channels: [
        { id: channel, name: "general", type: 0 },
        { id: otherChannel, name: "audit", type: 0 },
      ],
    },
    messages,
  });
  const runs = [
    run(runId, { [channel]: [first], [otherChannel]: [earliest] }),
    run(newerRunId, {
      [channel]: [
        message(
          messageId,
          channel,
          "同じIDの新しい実行",
          "2026-01-01T00:01:00Z",
        ),
      ],
    }),
  ];
  const mutations: Array<{ url: string; options: RequestInit }> = [];
  let launches = 0;
  script.runInNewContext({
    ...fixture.globals,
    ...globals,
    fetch: async (url: string, options: RequestInit = {}) => {
      const ok = (body: unknown) => ({
        ok: true,
        json: async () => structuredClone(body),
      });
      if (url === "/_admin/session") return ok({});
      if (url === "/_ui/session")
        return ok({
          csrf: "user-csrf",
          selectedUserId: userId,
          users: [
            { id: "alice", username: "Alice", bot: false },
            { id: "bob", username: "Bob", bot: false },
          ],
        });
      if (url === "/_ui/identity") {
        userId = JSON.parse(options.body as string).user_id;
        return ok({ selectedUserId: userId });
      }
      if (url === "/_ui/state") return ok({ guild: runs[0].guild });
      if (url === "/_admin/test-cases")
        return ok({
          cases: [{ id: "level.test.ts:0", name: "レベル確認" }],
          runningId: null,
          error: null,
        });
      if (url === "/_ui/test-cases/run") {
        launches++;
        return ok({ started: true });
      }
      if (url === "/_admin/test-runs")
        return ok({ runs: [...runs].reverse().map(({ id }) => ({ id })) });
      const found = runs.find((run) => url === `/_ui/test-runs/${run.id}`);
      if (found)
        return ok({
          ...found,
          messages: Object.fromEntries(
            Object.entries(found.messages).map(([id, items]) => [
              id,
              (items as (typeof first)[]).map((item) => ({
                ...item,
                canEdit: item.author.id === userId,
                canDelete: item.author.id === userId,
              })),
            ]),
          ),
        });
      if (url.startsWith("/_ui/messages/")) {
        mutations.push({ url, options });
        assert.equal(
          (options.headers as Record<string, string>)["x-discord-mock-csrf"],
          "user-csrf",
        );
        if (options.method === "PATCH")
          Object.assign(first, {
            content: JSON.parse(options.body as string).content,
            edited_timestamp: "2026-01-01T00:02:00Z",
          });
        if (options.method === "DELETE") runs[0].messages[channel] = [];
        return ok({ deleted: true });
      }
      throw new Error(url);
    },
  });
  await settle();
  const stream = fixture.streams.find(
    (stream) => stream.url === "/_admin/test-runs/events",
  );
  const article = (run = runId, ch = channel, id = messageId) =>
    fixture.elements.messages.children.find(
      (item) => item.id === `message-${run}-${ch}-${id}`,
    );
  return {
    ...fixture,
    runs,
    mutations,
    article,
    get launches() {
      return launches;
    },
    async refresh() {
      stream?.handlers.get("changed")?.();
      await settle();
    },
  };
}

test("右クリックで本人の編集・削除と全員のリンクコピーを提供し、更新中の入力を保持する", async () => {
  const chat = await openChat();
  const { elements } = chat;
  chat
    .article()
    ?.oncontextmenu({ preventDefault() {}, clientX: 300, clientY: 120 });
  assert.deepEqual(
    elements["message-menu"].children.map((item) => item.textContent),
    ["メッセージを編集", "メッセージを削除", "メッセージリンクをコピー"],
  );
  elements["message-menu"].children[2].onclick();
  await settle();
  assert.equal(
    chat.copied[0],
    `http://127.0.0.1:3000/test#channel=${channel}&message=${messageId}&run=${runId}`,
  );
  chat.article()?.oncontextmenu({ preventDefault() {} });
  elements["message-menu"].children[0].onclick();
  elements["message-edit-content"].value = "<script>編集中のテキスト</script>";
  await chat.refresh();
  assert.equal(
    elements["message-edit-content"].value,
    "<script>編集中のテキスト</script>",
  );
  elements["message-edit-form"].requestSubmit();
  elements["message-edit-form"].requestSubmit();
  await settle();
  assert.equal(chat.mutations.length, 1);
  assert.equal(chat.mutations[0].options.method, "PATCH");
  assert.match(chat.mutations[0].url, new RegExp(`runId=${runId}$`));
  assert.deepEqual(JSON.parse(chat.mutations[0].options.body as string), {
    content: "<script>編集中のテキスト</script>",
  });
  const editedMessage = chat.article();
  assert.ok(editedMessage);
  assert.match(
    textOf(editedMessage),
    /<script>編集中のテキスト<\/script>.*編集済み|編集済み.*<script>編集中のテキスト<\/script>/s,
  );

  elements.identity.value = "bob";
  elements.identity.onchange();
  await settle();
  chat.article()?.oncontextmenu({ preventDefault() {} });
  assert.deepEqual(
    elements["message-menu"].children.map((item) => item.textContent),
    ["メッセージリンクをコピー"],
  );
  elements["message-menu"].children[0].onclick();
  await settle();
  assert.equal(chat.copied.length, 2);
  elements.identity.value = "alice";
  elements.identity.onchange();
  await settle();
  chat.article()?.oncontextmenu({ preventDefault() {} });
  elements["message-menu"].children[1].onclick();
  assert.equal(
    chat.mutations.length,
    1,
    "メニュー操作だけでは削除せず確認を待つ",
  );
  elements["message-edit-form"].requestSubmit();
  await settle();
  assert.equal(chat.mutations[1].options.method, "DELETE");
  assert.equal(chat.article(), undefined);
  assert.ok(chat.article(newerRunId), "同じIDでも別実行のメッセージは残る");
});

test("実行ログから別チャンネルの最初の投稿へ移動し、URLの再読込と更新後も対象を保つ", async () => {
  const chat = await openChat();
  const log = chat.elements["test-log-entries"].children[0];
  log.onclick({ preventDefault() {} });
  const firstId = "123456789000005001";
  assert.equal(chat.elements["channel-title"].textContent, "# audit");
  assert.equal(
    chat.article(runId, otherChannel, firstId)?.scrolledIntoView,
    true,
  );
  assert.equal(
    chat.article(runId, otherChannel, firstId)?.classes.has("message-target"),
    true,
  );
  const hash = chat.globals.location.hash;
  chat.elements.messages.scrollTop = 125;
  chat.elements["test-log-entries"].scrollTop = 75;
  await chat.refresh();
  assert.equal(
    chat.elements.messages.scrollTop,
    125,
    "SSE更新で最下部へ押し戻さない",
  );
  assert.equal(chat.elements["test-log-entries"].scrollTop, 75);
  const reopened = await openChat(hash);
  assert.equal(reopened.elements["channel-title"].textContent, "# audit");
  assert.equal(
    reopened.article(runId, otherChannel, firstId)?.scrolledIntoView,
    true,
  );
  const missing = await openChat(
    `#channel=${channel}&message=999999999999999999&run=${runId}`,
  );
  assert.match(missing.elements.error.textContent, /削除済み|期限切れ|権限/);
});

test("リンクと実行ログの移動先は3秒だけ強調し、再描画では期限を延長しない", async () => {
  let now = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  const firstId = "123456789000005001";
  const hash = `#channel=${otherChannel}&message=${firstId}&run=${runId}`;
  const chat = await openChat(hash, {
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  });
  const highlighted = () =>
    chat.article(runId, otherChannel, firstId)?.classes.has("message-target");
  assert.equal(highlighted(), true, "URLで開いた投稿を強調する");
  chat.elements.messages.scrollTop = 125;
  advance(2999);
  await chat.refresh();
  assert.equal(highlighted(), true, "再描画後も残り時間だけ強調する");
  advance(1);
  assert.equal(highlighted(), false, "3秒ちょうどで通常の背景に戻す");
  assert.equal(
    chat.elements.messages.scrollTop,
    125,
    "強調解除でスクロール位置を変えない",
  );
  await chat.refresh();
  assert.equal(highlighted(), false, "期限後の再描画で強調を復活させない");

  const jump = () =>
    chat.elements["test-log-entries"].children[0].onclick({
      preventDefault() {},
    });
  jump();
  assert.equal(highlighted(), true, "実行ログからの移動でも強調する");
  advance(1000);
  jump();
  advance(2000);
  assert.equal(highlighted(), true, "再度移動したら、その時点から3秒数える");
  advance(999);
  assert.equal(highlighted(), true);
  advance(1);
  assert.equal(highlighted(), false);
});

test("過去の投稿を閲覧した後も、新しい実行とその進捗でチャット・ログの追従を再開する", async () => {
  const chat = await openChat();
  const { messages, "test-log-entries": logs } = chat.elements;
  const jumpToOldRun = () => {
    logs.children[0].onclick({ preventDefault() {} });
    messages.scrollTop = 100;
    logs.scrollTop = 40;
  };
  const assertFollowing = () => {
    assert.equal(messages.scrollTop, messages.scrollHeight);
    assert.equal(logs.scrollTop, logs.scrollHeight);
    assert.equal(chat.globals.location.hash, "");
  };
  jumpToOldRun();
  const running = {
    ...chat.runs[1],
    id: "33333333-3333-4333-8333-333333333333",
    name: "CLIからの新しい実行",
    status: "running",
    messages: { [channel]: [] },
    steps: [],
  };
  chat.runs.push(running);
  await chat.refresh();
  assertFollowing();
  jumpToOldRun();
  running.messages[channel].push({
    id: "123456789000005010",
    channel_id: channel,
    content: "新しいテストの投稿",
    timestamp: "2026-01-01T00:02:00Z",
    author: { id: "alice", username: "Alice", bot: false },
  });
  running.steps.push({ text: "投稿の検証", timestamp: "2026-01-01T00:02:00Z" });
  await chat.refresh();
  assertFollowing();
  assert.equal(
    chat.elements["channel-title"].textContent,
    "# general",
    "実行中の投稿先チャンネルも表示する",
  );
  messages.scrollTop = logs.scrollTop = 0;
  running.status = "passed";
  await chat.refresh();
  assertFollowing();
  jumpToOldRun();
  chat.runs.push({
    ...running,
    id: "44444444-4444-4444-8444-444444444444",
    status: "passed",
  });
  await chat.refresh();
  assertFollowing();
});

test("Webからテストを起動した時点でチャットとログを同時に末尾へ戻す", async () => {
  const hash = `#channel=${otherChannel}&message=123456789000005001&run=${runId}`;
  const chat = await openChat(hash);
  chat.elements.messages.scrollTop = 100;
  chat.elements["test-log-entries"].scrollTop = 40;
  chat.elements["test-case-list"].onkeydown({
    key: "Enter",
    preventDefault() {},
  });
  await settle();
  assert.equal(chat.launches, 1);
  assert.equal(chat.globals.location.hash, "");
  assert.equal(
    chat.elements.messages.scrollTop,
    chat.elements.messages.scrollHeight,
  );
  assert.equal(
    chat.elements["test-log-entries"].scrollTop,
    chat.elements["test-log-entries"].scrollHeight,
  );
  // ユーザータブの裏で更新されたログも、表示した時点で末尾へ追従する。
  chat.elements["test-users-tab"].onclick();
  chat.elements["test-log-entries"].scrollTop = 0;
  chat.elements["test-log-tab"].onclick();
  assert.equal(
    chat.elements["test-log-entries"].scrollTop,
    chat.elements["test-log-entries"].scrollHeight,
  );
});
