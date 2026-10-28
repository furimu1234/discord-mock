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
    assert.match(testPage, /id="test-case-buttons"/);
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
