import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { startSampleBot } from "../dist/bot.js";

const require = createRequire(import.meta.url);
const { startMock } = require("../../../apps/server/dist/server.cjs");

async function waitForReply(url, secret, interactionId, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/_mock/interactions/${interactionId}`, {
      headers: { "x-discord-mock-secret": secret },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    if (result.replied) return result.response;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the sample Bot to reply");
}

test("sample discord.js Bot replies to a real mock Gateway /ping interaction", { timeout: 10000 }, async () => {
  const mock = await startMock({ port: 0 });
  let bot;
  try {
    bot = await startSampleBot(mock.url, mock.token);
    assert.equal(bot.rest.options.api, `${mock.url}/api`);

    const create = await fetch(`${mock.url}/_mock/interaction`, {
      method: "POST",
      headers: {
        "x-discord-mock-secret": mock.adminSecret,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "ping", user_id: "123456789000000099" }),
    });
    assert.equal(create.status, 200);
    const { id } = await create.json();
    const reply = await waitForReply(mock.url, mock.adminSecret, id);
    assert.equal(reply.type, 4);
    assert.equal(reply.data.content, "Pong! 🦈");
  } finally {
    bot?.destroy();
    await mock.close();
  }
});

test("sample bot rejects real Discord tokens without contacting Discord", async () => {
  await assert.rejects(
    startSampleBot("http://127.0.0.1:3000", "real-token"),
    /Only a local mock_ token/,
  );
});
