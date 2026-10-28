import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs");
const channelId = "123456789000000002";

test("split routes preserve origin checks, authentication and JSON errors", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const botHeaders = { authorization: `Bot ${mock.token}`, "content-type": "application/json" };
    const adminHeaders = { "x-discord-mock-secret": mock.adminSecret };
    for (const path of ["/health", "/test", "/_ui/session", "/_mock/state", "/api/v10/users/@me"]) {
      const response = await fetch(mock.url + path, { headers: { ...botHeaders, ...adminHeaders, origin: "https://example.com" } });
      assert.equal(response.status, 403, path);
    }

    const sessionResponse = await fetch(`${mock.url}/_ui/session`);
    const session = await sessionResponse.json();
    const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${mock.url}/_mock/state`, {
      headers: { cookie, "x-discord-mock-csrf": session.csrf },
    })).status, 403);
    assert.equal((await fetch(`${mock.url}/api/v10/users/@me`, { headers: adminHeaders })).status, 401);
    assert.equal((await fetch(`${mock.url}/_ui/state`, { headers: adminHeaders })).status, 401);

    for (const body of ["{broken", "[]", "null", JSON.stringify({ content: "x".repeat(65_536) })]) {
      const response = await fetch(`${mock.url}/api/v10/channels/${channelId}/messages`, {
        method: "POST", headers: botHeaders, body,
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    const created = await fetch(`${mock.url}/_mock/interaction`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ custom_id: "confirm" }),
    });
    const { id, data } = await created.json();
    assert.equal(data.type, 3);
    assert.equal(data.data.custom_id, "confirm");
    const callbackPath = `/api/v10/interactions/${id}/${data.token}/callback`;
    assert.equal((await fetch(mock.url + callbackPath.replace(data.token, "wrong"), {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"type":4}',
    })).status, 404);
    const callback = await fetch(`${mock.url + callbackPath}?with_response=true`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: 4, data: { content: "Confirmed" } }),
    });
    assert.equal(callback.status, 200);
    assert.equal((await callback.json()).interaction.id, id);
    const result = await fetch(`${mock.url}/_mock/interactions/${id}`, { headers: adminHeaders });
    assert.equal((await result.json()).response.data.content, "Confirmed");
  } finally {
    await mock.close();
  }
});
