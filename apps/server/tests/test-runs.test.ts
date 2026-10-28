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
    assert.match(testPage, /id="test-preview"/);
    assert.match(testPage, /id="test-preview-messages"/);
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
