import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockClient } from "../src/index.mjs";

test("does not accept remote or production Discord base URLs", () => {
  assert.throws(() => createMockClient({ baseUrl: "https://discord.com" }), /local HTTP/);
  assert.throws(() => createMockClient({ baseUrl: "http://example.com" }), /local HTTP/);
});

test("queries local mock health without a real network request", async () => {
  let requested;
  const client = createMockClient({
    baseUrl: "http://127.0.0.1:3000",
    fetchImpl: async (url) => {
      requested = url.href;
      return { ok: true, json: async () => ({ status: "ok", service: "discord-mock" }) };
    },
  });
  assert.deepEqual(await client.health(), { status: "ok", service: "discord-mock" });
  assert.equal(requested, "http://127.0.0.1:3000/health");
});
