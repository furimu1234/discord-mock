import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import WebSocket from "ws";
import { Script } from "node:vm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs");
const channel = "123456789000000002";

async function session(mock) {
  const res = await fetch(`${mock.url}/_ui/session`);
  assert.equal(res.status, 200);
  return {
    data: await res.json(),
    cookie: res.headers.get("set-cookie").split(";")[0],
  };
}
function headers(data, cookie) {
  return { "content-type": "application/json", "x-discord-mock-csrf": data.csrf, cookie };
}

test("Browser dummy user and message routes require a session + CSRF", { timeout: 10000 }, async () => {
  const mock = await startMock({ port: 0 });
  try {
    const html = await (await fetch(`${mock.url}/test`)).text();
    assert.match(html, /id="message-form"/);
    const source = await (await fetch(`${mock.url}/_ui/client.js`)).text();
    assert.match(source, /EventSource/);
    assert.doesNotThrow(() => new Script(source), "Browser JavaScript should parse successfully");
    assert.match(source, /textContent/);
    assert.doesNotMatch(source, /innerHTML/);
    assert.equal((await fetch(`${mock.url}/_ui/state`)).status, 401);
    const { data, cookie } = await session(mock);
    assert.equal(data.users.length, 2);
    const denied = await fetch(`${mock.url}/_ui/identity`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ user_id: data.users[1].id }),
    });
    assert.equal(denied.status, 403);
    const switched = await fetch(`${mock.url}/_ui/identity`, {
      method: "POST", headers: headers(data, cookie),
      body: JSON.stringify({ user_id: data.users[1].id }),
    });
    assert.equal(switched.status, 200);
    const sent = await fetch(`${mock.url}/_ui/messages`, {
      method: "POST", headers: headers(data, cookie),
      body: JSON.stringify({ channel_id: channel, content: "<script>alert(1)</script>" }),
    });
    assert.equal(sent.status, 201);
    const msg = await sent.json();
    assert.equal(msg.author.id, data.users[1].id);
    const state = await (await fetch(`${mock.url}/_ui/state`, { headers: { cookie } })).json();
    assert.equal(state.selectedUserId, data.users[1].id);
    assert.equal(state.messages[channel][0].content, "<script>alert(1)</script>");
  } finally { await mock.close(); }
});

test("Slash command from browser travels through Gateway and Bot reply appears in timeline", { timeout: 12000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-attribution-"));
  const statePath = join(directory, "state.json");
  let mock = await startMock({ port: 0, statePath });
  const socket = new WebSocket(`${mock.url.replace("http:", "ws:")}/gateway`);
  try {
    const guildReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Missing GuildCreate")), 5000);
      socket.on("error", reject);
      socket.on("message", (raw) => {
        const p = JSON.parse(raw.toString());
        if (p.op === 10) socket.send(JSON.stringify({
          op: 2, d: { token: mock.token, intents: 0, properties: { os: "test", browser: "test", device: "test" } },
        }));
        if (p.t === "GUILD_CREATE") { clearTimeout(timer); resolve(); }
      });
    });
    await guildReady;
    const registration = await fetch(`${mock.url}/api/v10/applications/123456789000000001/commands`, {
      method: "PUT",
      headers: { authorization: `Bot ${mock.token}`, "content-type": "application/json" },
      body: JSON.stringify([{ name: "ping", description: "Check response" }]),
    });
    assert.equal(registration.status, 200);
    const [registeredCommand] = await registration.json();
    const { data, cookie } = await session(mock);
    const pending = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Missing InteractionCreate")), 5000);
      socket.on("message", (raw) => {
        const p = JSON.parse(raw.toString());
        if (p.t === "INTERACTION_CREATE") { clearTimeout(timer); resolve(p.d); }
      });
    });
    const create = await fetch(`${mock.url}/_ui/interaction`, {
      method: "POST", headers: headers(data, cookie),
      body: JSON.stringify({ channel_id: channel, name: "ping" }),
    });
    assert.equal(create.status, 201);
    const interaction = await pending;
    assert.equal(interaction.data.id, registeredCommand.id);
    assert.equal(interaction.member.user.id, data.selectedUserId);
    const switchUser = await fetch(`${mock.url}/_ui/identity`, {
      method: "POST", headers: headers(data, cookie),
      body: JSON.stringify({ user_id: data.users[1].id }),
    });
    assert.equal(switchUser.status, 200);
    const respond = () => fetch(
      `${mock.url}/api/v10/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: 4, data: { content: "Pong from Bot" } }),
      },
    );
    const callbacks = await Promise.all([respond(), respond()]);
    assert.deepEqual(callbacks.map((response) => response.status).sort(), [204, 400]);
    assert.equal((await callbacks.find((response) => response.status === 400).json()).code, 40060);
    const state = await (await fetch(`${mock.url}/_ui/state`, { headers: { cookie } })).json();
    assert.equal(state.botConnections, 1);
    assert.equal(state.messages[channel].at(-1).content, "Pong from Bot");
    assert.equal(state.messages[channel].at(-1).author.bot, true);
    assert.equal(state.messages[channel].length, 1, "concurrent initial callbacks create only one reply");
    const repeated = await respond();
    assert.equal(repeated.status, 400);
    assert.equal((await repeated.json()).code, 40060);
    const reply = state.messages[channel].at(-1);
    assert.equal(state.selectedUserId, data.users[1].id);
    assert.deepEqual(reply.interaction, { id: interaction.id, type: 2, name: "ping", user: interaction.member.user });
    assert.equal(reply.interaction_metadata.user.id, data.selectedUserId);
    assert.equal(reply.interaction_metadata.id, interaction.id);
    assert.equal(reply.application_id, "123456789000000001");
    assert.equal(JSON.stringify(reply).includes(interaction.token), false);
    const nextInteraction = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Missing next interaction")), 5000);
      socket.on("message", (raw) => {
        const packet = JSON.parse(raw.toString());
        if (packet.t === "INTERACTION_CREATE") { clearTimeout(timer); resolve(packet.d); }
      });
    });
    await fetch(`${mock.url}/_ui/interaction`, {
      method: "POST", headers: headers(data, cookie),
      body: JSON.stringify({ channel_id: channel, command_id: registeredCommand.id }),
    });
    const privateInteraction = await nextInteraction;
    const privateResponse = await fetch(
      `${mock.url}/api/v10/interactions/${privateInteraction.id}/${privateInteraction.token}/callback`,
      {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: 4, data: { content: "Private reply", flags: 64 } }),
      },
    );
    assert.equal(privateResponse.status, 400);
    const publicState = await (await fetch(`${mock.url}/_ui/state`, { headers: { cookie } })).json();
    assert.equal(publicState.messages[channel].some((message) => message.content === "Private reply"), false);
    socket.terminate();
    await mock.close();
    mock = await startMock({ port: 0, statePath });
    const restored = await (await fetch(`${mock.url}/_mock/state`, { headers: { "x-discord-mock-secret": mock.adminSecret } })).json();
    assert.deepEqual(restored.messages[channel].at(-1).interaction, reply.interaction);
    assert.deepEqual(restored.messages[channel].at(-1).interaction_metadata, reply.interaction_metadata);
  } finally {
    socket.terminate();
    await mock.close();
    await rm(directory, { recursive: true, force: true });
  }
});
