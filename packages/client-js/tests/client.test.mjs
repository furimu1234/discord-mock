import assert from "node:assert/strict";
import {test} from "node:test";
import {createMockClient, disMockClient} from "../dist/index.js";

test("blocks production REST base URLs", () => {
  assert.throws(() => createMockClient({baseUrl:"https://discord.com"}), /loopback/);
});
test("configures sdk REST route and keeps the same instance", () => {
  const fake = { emit() {}, rest: {options: {api:"https://discord.com/api"}} };
  const wrapped = disMockClient(fake);
  assert.equal(wrapped.client, fake);
  assert.equal(fake.rest.options.api, "http://127.0.0.1:3000/api");
});
test("never permits a real token for connect", async () => {
  const fake = { emit() {}, login() { throw new Error("should not run"); }, rest: {options: {api:""}} };
  await assert.rejects(disMockClient(fake).connect("real_discord_token"), /synthetic/);
});

test("wrapped and standalone health clients share redirect and error handling", async () => {
  for (const makeClient of [createMockClient, (options) => disMockClient({ emit() {} }, options)]) {
    const requests = [];
    const client = makeClient({
      baseUrl: "http://127.0.0.1:4567",
      fetchImpl: async (url, options) => {
        requests.push({ url: url.href, options });
        return { ok: true, json: async () => ({ status: "ok" }) };
      },
    });
    assert.deepEqual(await client.health(), { status: "ok" });
    assert.deepEqual(requests, [{ url: "http://127.0.0.1:4567/health", options: { redirect: "error" } }]);

    const failing = makeClient({ fetchImpl: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(failing.health(), /HTTP 503/);
  }
});
