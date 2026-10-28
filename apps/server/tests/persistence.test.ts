import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs");
const channelId = "123456789000000002";

test("browser and Bot messages share JSON state and survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-state-"));
  const statePath = join(directory, "state.json");
  let mock;
  try {
    mock = await startMock({ port: 0, statePath });
    const sessionResponse = await fetch(`${mock.url}/_ui/session`);
    const session = await sessionResponse.json();
    const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
    const sent = await fetch(`${mock.url}/_ui/messages`, {
      method: "POST",
      headers: { cookie, "x-discord-mock-csrf": session.csrf, "content-type": "application/json" },
      body: JSON.stringify({ channel_id: channelId, content: "From browser" }),
    });
    assert.equal(sent.status, 201);
    const reply = await fetch(`${mock.url}/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${mock.token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: "From Bot" }),
    });
    assert.equal(reply.status, 200);
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    assert.deepEqual(saved.messages[channelId].map((message) => message.content), ["From browser", "From Bot"]);
    assert.equal(saved.messages[channelId][0].author.id, session.selectedUserId);
    assert.equal(saved.messages[channelId][1].author.bot, true);
    assert.equal(saved.messages[channelId][1].interaction, undefined, "ordinary Bot posts have no command attribution");

    await mock.close();
    mock = undefined;
    mock = await startMock({ port: 0, statePath });
    const restored = await fetch(`${mock.url}/_mock/state`, {
      headers: { "x-discord-mock-secret": mock.adminSecret },
    });
    assert.deepEqual(await restored.json(), saved);
  } finally {
    await mock?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid saved JSON fails startup without overwriting the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-invalid-"));
  const statePath = join(directory, "state.json");
  try {
    for (const content of ["{broken", '{"user":{}}']) {
      await writeFile(statePath, content);
      await assert.rejects(startMock({ port: 0, statePath }));
      assert.equal(await readFile(statePath, "utf8"), content);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed persisted command attribution fails startup without losing existing JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-invalid-attribution-"));
  const statePath = join(directory, "state.json");
  const mock = await startMock({ port: 0 });
  try {
    const state = await (await fetch(`${mock.url}/_mock/state`, { headers: { "x-discord-mock-secret": mock.adminSecret } })).json();
    for (const message of [{ interaction: { type: 2 } }, { interaction_metadata: { type: 2, user: null } }, { embeds: [{ title: {} }] }]) {
      state.messages[channelId] = [message];
      const content = JSON.stringify(state);
      await writeFile(statePath, content);
      await assert.rejects(startMock({ port: 0, statePath }), /Invalid saved|Embed/);
      assert.equal(await readFile(statePath, "utf8"), content);
    }
  } finally {
    await mock.close();
    await rm(directory, { recursive: true, force: true });
  }
});
