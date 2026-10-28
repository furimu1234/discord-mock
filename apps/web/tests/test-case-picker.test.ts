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
  for (let i = 0; i < 5; i++) await setImmediate();
};

async function openPicker() {
  const fixture = createBrowserFixture("/test");
  const cases = [
    { id: "levels.test.ts:0", name: "レベル確認 › 初期値" },
    { id: "levels.test.ts:1", name: "レベル確認 › 投稿後" },
    { id: "levels.test.ts:2", name: "権限確認 <script>" },
  ];
  const starts: Array<{ body: string; headers: Record<string, string> }> = [];
  let runningId: string | null = null;
  let finishLaunch: () => void = () => {};
  let now = 0;
  let timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();

  script.runInNewContext({
    ...fixture.globals,
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++timerId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    fetch: async (
      url: string,
      options: { body: string; headers: Record<string, string> },
    ) => {
      const ok = (body: unknown) => ({ ok: true, json: async () => body });
      if (url === "/_admin/session") return ok({});
      if (url === "/_ui/session")
        return ok({
          csrf: "ui-csrf",
          selectedUserId: "alice",
          users: [{ id: "alice", username: "Alice", bot: false }],
        });
      if (url === "/_ui/state") return ok({ guild: { channels: [] } });
      if (url === "/_admin/test-runs") return ok({ runs: [] });
      if (url === "/_admin/test-cases")
        return ok({ cases, runningId, error: null });
      if (url === "/_ui/test-cases/run") {
        starts.push(options);
        runningId = (JSON.parse(options.body) as { id: string }).id;
        await new Promise<void>((resolve) => {
          finishLaunch = resolve;
        });
        return ok({ started: true });
      }
      throw new Error(url);
    },
  });
  await settle();
  const stream = fixture.streams.find(
    (item) => item.url === "/_admin/test-runs/events",
  );
  assert.ok(stream);
  return {
    list: fixture.elements["test-case-list"],
    cases,
    starts,
    async refresh() {
      stream.handlers.get("changed")?.();
      await settle();
    },
    async acceptLaunch() {
      finishLaunch();
      await settle();
    },
    async finishRun() {
      runningId = null;
      stream.handlers.get("changed")?.();
      await settle();
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

test("矢印キーとマウスで項目を選び、Enterで一度だけ実行する", async () => {
  const picker = await openPicker();
  const { list, starts } = picker;
  const key = (key: string, extra = {}) =>
    list.onkeydown({ key, preventDefault() {}, ...extra });
  const selected = () =>
    list.children.findIndex(
      (row) => row.attributes.get("aria-selected") === "true",
    );
  assert.equal(selected(), 0);
  key("ArrowDown");
  assert.equal(selected(), 1);
  assert.equal(
    list.children[1].scrolledIntoView,
    true,
    "キーボードで選んだ項目をリスト内に表示する",
  );
  key("ArrowRight");
  assert.equal(selected(), 2);
  key("ArrowDown");
  assert.equal(selected(), 2);
  key("ArrowLeft");
  assert.equal(selected(), 1);
  key("ArrowUp");
  assert.equal(selected(), 0);
  key("ArrowUp");
  assert.equal(selected(), 0);
  key("End");
  assert.equal(selected(), 2);
  key("Home");
  assert.equal(selected(), 0);
  list.children[2].onpointerenter();
  assert.equal(selected(), 2);
  assert.equal(list.children[2].classes.has("active"), true);
  assert.equal(
    list.attributes.get("aria-activedescendant"),
    list.children[2].attributes.get("id"),
  );
  assert.equal(textOf(list.children[2]), "権限確認 <script>");
  list.children[1].onpointermove();
  list.children[1].onclick();
  assert.equal(selected(), 1);
  assert.equal(list.focused, true);
  key("Enter", { repeat: true });
  key("Enter", { isComposing: true });
  await settle();
  assert.equal(
    starts.length,
    0,
    "シングルクリック・キーリピート・IME変換確定では実行しない",
  );

  key("Enter");
  assert.equal(list.children[1].children[0].textContent, "●");
  assert.equal(list.attributes.get("aria-disabled"), "true");
  key("Enter");
  list.children[1].ondblclick();
  await settle();
  assert.equal(
    starts.length,
    1,
    "起動リクエストの完了待ちでは連打を受け付けない",
  );
  assert.deepEqual(JSON.parse(starts[0].body), { id: picker.cases[1].id });
  assert.equal(starts[0].headers["x-discord-mock-csrf"], "ui-csrf");
  await picker.acceptLaunch();
  key("Enter");
  await settle();
  assert.equal(starts.length, 1, "実行中も再実行を受け付けない");

  const selectedRow = list.children[1];
  list.scrollTop = 60;
  await picker.refresh();
  assert.equal(list.children[1], selectedRow);
  picker.cases[1].name += " 更新";
  await picker.refresh();
  assert.equal(list.children[1].attributes.get("aria-selected"), "true");
  assert.equal(list.scrollTop, 60);
  assert.equal(
    list.children[1].children[0].textContent,
    "●",
    "一覧が変わっても表示時間を引き継ぐ",
  );
  picker.advance(2999);
  assert.equal(list.children[1].children[0].textContent, "●");
  picker.advance(1);
  assert.equal(
    list.children[1].children[0].textContent,
    "",
    "テスト実行中でも3秒経過したら消す",
  );
});

test("ダブルクリックした印は実行完了で消えず、再実行から3秒間表示する", async () => {
  const picker = await openPicker();
  const marker = () => picker.list.children[0].children[0].textContent;
  picker.list.children[0].ondblclick();
  await settle();
  assert.equal(picker.starts.length, 1);
  assert.equal(marker(), "●");
  await picker.acceptLaunch();
  await picker.finishRun();
  picker.advance(2000);
  assert.equal(marker(), "●", "実行完了で印を消さない");
  picker.list.children[0].ondblclick();
  await settle();
  assert.equal(picker.starts.length, 2);
  picker.advance(1000);
  assert.equal(marker(), "●", "再実行前のタイマーでは消えない");
  await picker.acceptLaunch();
  await picker.finishRun();
  picker.advance(1999);
  assert.equal(marker(), "●");
  picker.advance(1);
  assert.equal(marker(), "");
});
