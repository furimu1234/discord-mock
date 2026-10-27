import assert from "node:assert/strict";
import { test } from "node:test";
import { listenLocal } from "../src/server.mjs";

test("server binds only to loopback by default", async () => {
  const { server, url } = await listenLocal({ port: 0 });
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:/);
    const response = await fetch(`${url}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "discord-mock" });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const preview = await fetch(`${url}/admin`);
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /管理画面（未実装）/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("public bind and invalid port are rejected", async () => {
  await assert.rejects(listenLocal({ host: "0.0.0.0" }), /Remote bind is disabled/);
  await assert.rejects(listenLocal({ port: -1 }), /port must be/);
});
