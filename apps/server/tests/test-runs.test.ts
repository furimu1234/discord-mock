import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { startMock } = createRequire(import.meta.url)("../dist/server.cjs");

async function adminHeaders(mock) {
  const response = await fetch(`${mock.url}/_admin/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discord-mock-local": "1",
    },
    body: "{}",
  });
  const session = await response.json();
  return {
    cookie: response.headers.get("set-cookie").split(";")[0],
    "x-discord-mock-admin-csrf": session.csrf,
    "content-type": "application/json",
  };
}

test("UT の表示用コピーを共有し、普段の状態を変更せず終了後にも保持する", async () => {
  const app = await startMock({ port: 0 });
  const sut = await startMock({ port: 0 });
  try {
    const before = app.testing.snapshot();
    const user = sut.testing.users.findByName("Alice");
    const channel = sut.testing.channels.findByName("general");
    await sut.testing.as(user).sendMessage(channel.id, "UT の投稿");
    const snapshot = sut.testing.snapshot();
    snapshot.messages[channel.id][0].privateField = "表示へ渡さない";
    snapshot.messages[channel.id][0].author.privateField = "表示へ渡さない";
    const headers = await adminHeaders(app);
    const body = {
      name: "レベル確認 UT",
      status: "running",
      step: "実行",
      snapshot,
    };
    const created = await fetch(`${app.url}/_admin/test-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(created.status, 201);
    const run = await created.json();
    assert.equal(run.status, "running");
    const url = `${app.url}/_admin/test-runs/${run.id}`;
    const completed = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...body, status: "passed", step: "確認完了" }),
    });
    assert.equal(completed.status, 200);
    await sut.close();
    const view = await (await fetch(url, { headers })).json();
    assert.equal(view.status, "passed");
    assert.deepEqual(
      view.steps.map((step) => step.text),
      ["実行", "確認完了"],
    );
    assert.equal(view.messages[channel.id][0].content, "UT の投稿");
    assert.equal(JSON.stringify(view).includes("表示へ渡さない"), false);
    assert.deepEqual(app.testing.snapshot(), before);
    assert.equal(
      (await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) }))
        .status,
      409,
    );
    assert.equal((await fetch(`${app.url}/tests`)).status, 200);
    const testPage = await (await fetch(`${app.url}/test`)).text();
    assert.match(testPage, /id="test-case-list"[^>]*role="listbox"[^>]*tabindex="0"/);
    assert.doesNotMatch(testPage, /id="test-case-(select|run)"/);
    assert.match(testPage, /Enter \/ ダブルクリックで実行/);
    assert.match(testPage, /id="test-log-panel"/);
    assert.match(testPage, /id="channels"/);
    assert.match(testPage, /id="messages"/);
  } finally {
    await sut.close();
    await app.close();
  }
});

test("表示用 API も管理認証・CSRF・origin・スナップショットの検証を必須にする", async () => {
  const app = await startMock({ port: 0 });
  try {
    const url = `${app.url}/_admin/test-runs`;
    const headers = await adminHeaders(app);
    const body = {
      name: "UT",
      status: "running",
      snapshot: app.testing.snapshot(),
    };
    assert.equal((await fetch(url)).status, 403);
    const dummy = await fetch(`${app.url}/_ui/session`);
    const dummyCookie = dummy.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await fetch(url, { headers: { cookie: dummyCookie } })).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            cookie: headers.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { ...headers, origin: "http://localhost:5555" },
          body: JSON.stringify(body),
        })
      ).status,
      403,
    );
    for (const value of [
      { ...body, snapshot: {} },
      { ...body, status: "unknown" },
      { ...body, snapshot: { ...body.snapshot, version: 2 } },
      { ...body, name: "x".repeat(201) },
    ]) {
      assert.equal(
        (
          await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(value),
          })
        ).status,
        400,
      );
    }
    for (let index = 0; index < 20; index++)
      assert.equal(
        (
          await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
        201,
      );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      ).status,
      429,
    );
    assert.equal(
      (await (await fetch(url, { headers })).json()).runs.length,
      20,
    );
  } finally {
    await app.close();
  }
});

test("テストケース実行はローカル管理セッションと CSRF を必須にする", async () => {
  const started: string[] = [];
  const mock = await startMock({
    port: 0,
    testCases: {
      list: async () => [{ id: "leveling.test.ts:0", name: "レベルが増える" }],
      status: () => ({ runningId: null, error: null }),
      async start(id: string) {
        if (id !== "leveling.test.ts:0") throw new Error("指定されたテストケースは存在しません");
        started.push(id);
      },
      async close() {},
    },
  });
  try {
    const url = `${mock.url}/_admin/test-cases`;
    assert.equal((await fetch(url)).status, 403);
    const admin = await adminHeaders(mock);
    const response = await fetch(url, { headers: { cookie: admin.cookie } });
    assert.equal(response.status, 200);
    const { cases } = await response.json();
    assert.deepEqual(cases, [{ id: "leveling.test.ts:0", name: "レベルが増える" }]);
    const post = (body: unknown, headers: Record<string, string>) => fetch(`${url}/run`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const noCsrf = await post({ id: "leveling.test.ts:0" }, { cookie: admin.cookie, "content-type": "application/json" });
    assert.equal(noCsrf.status, 403);
    assert.deepEqual(started, []);
    const bad = await post({ id: "arbitrary command" }, admin);
    assert.equal(bad.status, 409);
    assert.deepEqual(started, []);
    const startedResponse = await post({ id: "leveling.test.ts:0" }, admin);
    assert.equal(startedResponse.status, 202);
    assert.deepEqual(started, ["leveling.test.ts:0"]);
  } finally {
    await mock.close();
  }
});


test("UT起動時のログインユーザーはブラウザセッションから決まり、bodyの偽装IDを無視する", async () => {
  const launches: Array<{ caseId: string; userId: string | undefined }> = [];
  const mock = await startMock({
    port: 0,
    testCases: {
      list: async () => [{ id: "showLvl.test.ts:0", name: "レベル確認" }],
      status: () => ({ runningId: null, error: null }),
      async start(id, userId) { launches.push({ caseId: id, userId }); },
      async close() {},
    },
  });
  try {
    const base = mock.url;
    const sessionResponse = await fetch(`${base}/_ui/session`);
    const session = await sessionResponse.json() as { csrf: string; selectedUserId: string; users: Array<{id: string; username: string}> };
    const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const url = `${base}/_ui/test-cases/run`;
    const body = JSON.stringify({ id: "showLvl.test.ts:0", user_id: "spoofed" });
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" }, body })).status, 403);
    const headers = { cookie, "content-type": "application/json", "x-discord-mock-csrf": session.csrf };
    assert.equal((await fetch(url, { method: "POST", headers, body })).status, 202);
    assert.deepEqual(launches, [{ caseId: "showLvl.test.ts:0", userId: session.selectedUserId }]);
    const another = session.users.find(u => u.id !== session.selectedUserId);
    assert.ok(another);
    const switchUser = await fetch(`${base}/_ui/identity`, {
      method: "POST", headers, body: JSON.stringify({ user_id: another.id }),
    });
    assert.equal(switchUser.status, 200);
    assert.equal((await fetch(url, { method: "POST", headers, body })).status, 202);
    assert.deepEqual(launches[1], { caseId: "showLvl.test.ts:0", userId: another.id });
  } finally {
    await mock.close();
  }
});


test("既定のMockにはBotを除く10人のダミーユーザーとプロフィール用ロールがある", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const response = await fetch(`${mock.url}/_ui/session`);
    const session = await response.json() as {
      users: Array<{ id: string; username: string; bot: boolean }>;
      roles: Array<{ id: string; name: string }>;
      members: Array<{ user: { id: string }; roles: string[] }>;
    };
    assert.equal(session.users.filter((user) => !user.bot).length, 10);
    assert.ok(session.roles.some((role) => role.name === "Moderator"));
    const moderator = session.users.find((user) => user.username === "Charlie");
    assert.ok(moderator);
    assert.ok(session.members.find((member) => member.user.id === moderator.id)?.roles.length);
  } finally {
    await mock.close();
  }
});

test("UTの実DBスナップショットを管理者だけが読み取れ、元のApp DBへ混入しない", async () => {
  const app = await startMock({ port: 0 });
  const headers = await adminHeaders(app);
  try {
    const snapshot = app.testing.snapshot();
    const database = {
      truncated: false,
      tables: [{
        schema: "example", name: "lvl", totalRows: 2, truncated: false,
        columns: [
          { name: "user_id", type: "varchar(19)", nullable: false, primaryKey: false },
          { name: "lvl", type: "integer", nullable: false, primaryKey: false },
        ],
        rows: [["Alice", 2], ["Bob", 7]],
      }],
    };
    const posted = await fetch(`${app.url}/_admin/test-runs`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "Level UT", status: "running", snapshot }),
    });
    assert.equal(posted.status, 201);
    const runId = (await posted.json()).id;
    assert.equal((await fetch(`${app.url}/_admin/database/tables?runId=${runId}`)).status, 403);
    const done = await fetch(`${app.url}/_admin/test-runs/${runId}`, {
      method: "PUT", headers,
      body: JSON.stringify({ name: "Level UT", status: "passed", snapshot, database }),
    });
    assert.equal(done.status, 200);
    const listed = await (await fetch(`${app.url}/_admin/test-runs`, { headers })).json();
    assert.equal(listed.runs[0].hasDatabase, true);
    const tables = await (await fetch(`${app.url}/_admin/database/tables?runId=${runId}`, { headers })).json();
    assert.deepEqual(tables.tables, [{ schema: "example", name: "lvl", columnCount: 2 }]);
    const rowsUrl = `${app.url}/_admin/database/rows?runId=${runId}&schema=example&table=lvl`;
    const page = await (await fetch(rowsUrl, { headers })).json();
    assert.deepEqual(page.rows, [["Alice", 2], ["Bob", 7]]);
    const sorted = await (await fetch(`${rowsUrl}&sort=lvl&direction=desc`, { headers })).json();
    assert.deepEqual(sorted.rows, [["Bob", 7], ["Alice", 2]]);
    const filtered = await (await fetch(`${rowsUrl}&search=Bob`, { headers })).json();
    assert.deepEqual(filtered.rows, [["Bob", 7]]);
    assert.equal((await fetch(`${rowsUrl}&sort=invalid`, { headers })).status, 404);
    assert.equal((await fetch(`${app.url}/_admin/database/tables?runId=invalid`, { headers })).status, 400);
    assert.equal((await fetch(`${app.url}/_admin/database/tables?runId=99999999-9999-4999-8999-999999999999`, { headers })).status, 404);
    assert.equal((await fetch(`${app.url}/_admin/database/tables`, { headers })).status, 503);
    const view = await (await fetch(`${app.url}/_admin/test-runs/${runId}`, { headers })).json();
    assert.deepEqual(view.database, database);
  } finally {
    await app.close();
  }
});

test("UTのDBスナップショットは不正値や破損構造を拒否する", async () => {
  const app = await startMock({ port: 0 });
  const headers = await adminHeaders(app);
  try {
    const snapshot = app.testing.snapshot();
    const valid = {
      truncated: false,
      tables: [{
        schema: "example", name: "lvl", totalRows: 1, truncated: false,
        columns: [{ name: "lvl", type: "int", nullable: false, primaryKey: false }],
        rows: [[7]],
      }],
    };
    for (const database of [
      { ...valid, tables: [{ ...valid.tables[0], rows: [[7, "extra"]] }] },
      { ...valid, tables: [{ ...valid.tables[0], rows: [[{ secret: "unsafe" }]] }] },
      { ...valid, tables: [{ ...valid.tables[0], rows: [[7]], totalRows: -1 }] },
      { ...valid, tables: [{ ...valid.tables[0], rows: [[7]], schema: "" }] },
      { ...valid, tables: [{ ...valid.tables[0], rows: [[7]], columns: [] }] },
    ]) {
      const result = await fetch(`${app.url}/_admin/test-runs`, {
        method: "POST", headers, body: JSON.stringify({ name: "Invalid", snapshot, database }),
      });
      assert.equal(result.status, 400);
    }
  } finally {
    await app.close();
  }
});

test("ブラウザセッションのCSRFでチャンネルを作成でき、同名の重複は拒否する", async () => {
  const app = await startMock({ port: 0 });
  try {
    const sessionResponse = await fetch(`${app.url}/_ui/session`);
    const session = await sessionResponse.json() as { csrf: string };
    const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const url = `${app.url}/_ui/channels`;
    const body = JSON.stringify({ name: "test-room" });
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" }, body })).status, 403);
    const headers = { cookie, "content-type": "application/json", "x-discord-mock-csrf": session.csrf };
    const created = await fetch(url, { method: "POST", headers, body });
    assert.equal(created.status, 201);
    const channel = await created.json() as { id: string; name: string; type: number };
    assert.equal(channel.name, "test-room");
    assert.equal(channel.type, 0);
    const state = await (await fetch(`${app.url}/_ui/state`, { headers: { cookie } })).json() as { guild: { channels: Array<{ id: string; name: string }> } };
    assert.ok(state.guild.channels.some((item) => item.id === channel.id));
    assert.equal((await fetch(url, { method: "POST", headers, body })).status, 409);
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ name: "" }) })).status, 400);
  } finally { await app.close(); }
});
