import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { request as httpRequest } from "node:http";

const { startMock } = createRequire(import.meta.url)("../dist/server.cjs");

test("standalone Mock can render DB tab without bundling a database runtime", async () => {
  const mock = await startMock({ port: 0 });
  try {
    assert.equal((await fetch(`${mock.url}/database`)).status, 200);
    assert.deepEqual(await (await fetch(`${mock.url}/_admin/session`)).json(), { authenticated: false, databaseAvailable: false });
    const response = await fetch(`${mock.url}/_admin/database/tables`, { headers: { "x-discord-mock-secret": mock.adminSecret } });
    assert.equal(response.status, 503);
    const badLogin = await fetch(`${mock.url}/_admin/session`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ secret: mock.adminSecret }) });
    assert.equal(badLogin.status, 415);
  } finally { await mock.close(); }
});

test("local DB session opens without a key but rejects cross-origin and rebinding requests", { timeout: 10000 }, async () => {
  const mock = await startMock({ port: 0, database: { tables: async () => [], rows: async () => null } });
  try {
    const open = (headers = {}) => fetch(`${mock.url}/_admin/session`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}",
    });
    assert.equal((await open()).status, 403, "a generic form/body cannot open a DB session");
    const localHeaders = { "x-discord-mock-local": "1" };
    // Use raw HTTP for adversarial Host / Fetch Metadata; fetch can normalize them.
    const rawOpen = (headers) => new Promise((resolve, reject) => {
      const request = httpRequest(new URL("/_admin/session", mock.url), {
        method: "POST", headers: { "content-type": "application/json", ...localHeaders, ...headers },
      }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end("{}");
    });
    for (const headers of [
      { origin: "http://localhost:5555" },
      { host: `other.invalid:${new URL(mock.url).port}` },
      { "sec-fetch-site": "cross-site" },
    ]) assert.equal(await rawOpen(headers), 403, JSON.stringify(headers));
    const response = await open({ ...localHeaders, origin: mock.url, "sec-fetch-site": "same-origin" });
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.equal(session.authenticated, true);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    assert.equal((await fetch(`${mock.url}/_admin/database/tables`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${mock.url}/_mock/state`, { headers: { cookie } })).status, 403, "local DB access cannot authorize test administration");
    const reused = await open({ ...localHeaders, cookie });
    assert.equal((await reused.json()).csrf, session.csrf);
    assert.equal(reused.headers.get("set-cookie"), null);
    const revoke = await fetch(`${mock.url}/_admin/session`, { method: "DELETE", headers: { cookie, "x-discord-mock-admin-csrf": session.csrf } });
    assert.equal(revoke.status, 200);
    assert.equal((await fetch(`${mock.url}/_admin/database/tables`, { headers: { cookie } })).status, 403);
  } finally { await mock.close(); }
});
