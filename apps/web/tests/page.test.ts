import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { createBrowserFixture, textOf } from "./browser-fixture.ts";

const source = await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8");
const script = new Script(source);

test("compiled browser script renders state, switches users, posts and refreshes from SSE", async () => {
  const fixture = createBrowserFixture();
  const users = [
    { id: "alice", username: "Alice", bot: false },
    { id: "bob", username: "Bob", bot: false },
  ];
  const state = {
    guild: { name: "Test Guild", channels: [{ id: "general", name: "general", type: 0 }] },
    users,
    selectedUserId: "alice",
    botConnections: 1,
    messages: { general: [] as Array<{content: string; [key: string]: unknown}> },
    commands: [
      { id: "ping-id", name: "ping", description: "Respond with Pong" },
      { id: "status-id", name: "status", description: "Show status" },
    ],
  };
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, ...options });
    switch (url) {
      case "/_ui/session":
        return { ok: true, json: async () => ({ csrf: "csrf-test", selectedUserId: "alice", users }) };
      case "/_ui/identity":
        state.selectedUserId = JSON.parse(options.body).user_id;
        return { ok: true, json: async () => ({ selectedUserId: state.selectedUserId }) };
      case "/_ui/messages":
      case "/_ui/interaction":
        return { ok: true, json: async () => ({ id: "created" }) };
      case "/_ui/state":
        return { ok: true, json: async () => state };
      default:
        throw new Error(`Unexpected request: ${url}`);
    }
  };
  script.runInNewContext({ ...fixture.globals, fetch });
  await setImmediate();

  const { elements, streams } = fixture;
  assert.equal(elements["server-title"].textContent, "Test Guild");
  assert.equal(elements.identity.value, "alice");
  assert.equal(streams[0].url, "/_ui/events");

  elements.identity.value = "bob";
  elements.identity.onchange();
  await setImmediate();
  assert.equal(elements.identity.value, "bob");
  const identityRequest = requests.find((request) => request.url === "/_ui/identity");
  assert.equal(identityRequest.headers["x-discord-mock-csrf"], "csrf-test");
  assert.equal(identityRequest.credentials, "same-origin");

  elements["message-input"].value = "Hello";
  elements["message-form"].requestSubmit();
  await setImmediate();
  const messageRequest = requests.find((request) => request.url === "/_ui/messages");
  assert.deepEqual(JSON.parse(messageRequest.body), { channel_id: "general", content: "Hello" });
  assert.equal(elements["message-input"].value, "");
  assert.equal(elements.send.disabled, false);

  const input = elements["message-input"];
  input.value = "/";
  input.oninput();
  assert.equal(elements["command-picker"].classes.has("hidden"), false);
  assert.equal(elements["command-suggestions"].children.length, 2);
  let prevented = false;
  input.onkeydown({ key: "ArrowDown", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(input.attributes.get("aria-activedescendant"), "command-option-1");
  input.onkeydown({ key: "Tab", preventDefault() {} });
  assert.equal(input.value, "/status");
  assert.equal(elements["command-picker"].classes.has("hidden"), true);

  input.value = "/pi";
  input.oninput();
  assert.equal(elements["command-suggestions"].children.length, 1);
  assert.match(textOf(elements["command-suggestions"]), /Respond with Pong/);
  input.onkeydown({ key: "Escape", preventDefault() {} });
  assert.equal(elements["command-picker"].classes.has("hidden"), true);
  input.oninput();
  input.onkeydown({ key: "Enter", isComposing: true, preventDefault() { throw new Error("IME must be preserved"); } });
  input.onkeydown({ key: "Enter", preventDefault() {} });
  assert.equal(input.value, "/ping");
  assert.equal(requests.filter((request) => request.url === "/_ui/interaction").length, 0);
  input.value = "/pi";
  input.oninput();
  elements["command-suggestions"].children[0].onclick();
  assert.equal(input.value, "/ping");
  assert.equal(input.focused, true);
  elements["message-form"].requestSubmit();
  await setImmediate();
  const commandRequest = requests.find((request) => request.url === "/_ui/interaction");
  assert.deepEqual(JSON.parse(commandRequest.body), { channel_id: "general", command_id: "ping-id" });

  input.value = "/missing";
  input.oninput();
  assert.equal(elements["command-empty"].classes.has("hidden"), false);
  elements["message-form"].requestSubmit();
  await setImmediate();
  assert.equal(requests.filter((request) => request.url === "/_ui/interaction").length, 1);
  assert.match(elements.error.textContent, /登録済み/);

  state.commands.push({ id: "new-id", name: "new", description: "New registration" });
  input.value = "/new";
  input.oninput();
  streams[0].handlers.get("changed")();
  await setImmediate();
  assert.equal(elements["command-suggestions"].children.length, 1);
  assert.match(textOf(elements["command-suggestions"]), /New registration/);

  state.commands.push({ id: "unicode-id", name: "コマンドテスト", description: "日本語コマンド" });
  input.value = "/コマ";
  streams[0].handlers.get("changed")();
  await setImmediate();
  input.oninput();
  assert.equal(elements["command-suggestions"].children.length, 1);
  assert.match(textOf(elements["command-suggestions"]), /コマンドテスト/);
  elements["command-suggestions"].children[0].onclick();
  elements["message-form"].requestSubmit();
  await setImmediate();
  const unicodeRequest = requests.filter((request) => request.url === "/_ui/interaction").at(-1);
  assert.equal(JSON.parse(unicodeRequest.body).command_id, "unicode-id");

  state.messages.general.push({ author: users[1], content: "<script>alert(1)</script>", timestamp: "2026-01-01T00:00:00Z" });
  streams[0].handlers.get("changed")();
  await setImmediate();
  assert.match(textOf(elements.messages), /<script>alert\(1\)<\/script>/);
  const message = elements.messages.children.at(-1);
  assert.equal(message.children[1].children[1].tagName, "DIV");
  assert.equal(message.children[1].children[1].textContent, "<script>alert(1)</script>");
  state.messages.general.push({
    author: { id: "bot", username: "Test Bot", bot: true }, content: "Pong!", timestamp: "2026-01-01T00:00:00Z",
    interaction: { id: "invocation", type: 2, name: "コマンドテスト", user: users[0] },
  });
  streams[0].handlers.get("changed")();
  await setImmediate();
  const reply = elements.messages.children.at(-1);
  assert.equal(reply.classes.has("has-invocation"), true);
  assert.equal(textOf(reply.children[0]), "AAliceさんが/コマンドテストを使用しました");
  assert.equal(reply.children[2].children[1].textContent, "Pong!");
  assert.equal(elements.identity.value, "bob", "attribution uses the original actor, independent of selected user");
  state.messages.general.at(-1).content = "";
  state.messages.general.at(-1).embeds = [{
    type: "rich", title: "Alice | lvl", description: "<script>alert(1)</script>", color: 0x12abcd,
    fields: [{ name: "今のレベルはこれだ", value: "3", inline: true }],
    footer: { text: "<img src=x onerror=alert(1)>" },
  }];
  streams[0].handlers.get("changed")();
  await setImmediate();
  const card = elements.messages.children.at(-1).children[2].children[2];
  assert.equal(card.tagName, "SECTION");
  assert.equal(card.style.borderLeftColor, "#12abcd");
  assert.equal(card.children[0].textContent, "Alice | lvl");
  assert.equal(card.children[1].textContent, "<script>alert(1)</script>");
  assert.match(textOf(card), /今のレベルはこれだ3/);
  assert.equal(card.children[2].children[0].className, "embed-field inline");
  assert.equal(card.children[3].className, "embed-footer");
  assert.equal(card.children[3].textContent, "<img src=x onerror=alert(1)>");
});

test("admin screen opens a session without subscribing to the test timeline", async () => {
  const fixture = createBrowserFixture("/admin");
  const requestedUrls = [];
  script.runInNewContext({
    ...fixture.globals,
    fetch: async (url) => {
      requestedUrls.push(url);
      return { ok: true, json: async () => ({ csrf: "csrf", selectedUserId: "alice", users: [] }) };
    },
  });
  await setImmediate();
  assert.deepEqual(requestedUrls, ["/_ui/session"]);
  assert.equal(fixture.streams.length, 0);
  assert.equal(fixture.elements["test-panel"].classes.has("hidden"), true);
  assert.equal(fixture.elements["admin-panel"].classes.has("hidden"), false);
});

test("pending submissions and repeated Enter keys never send a message or command twice", async () => {
  const fixture = createBrowserFixture();
  const sends = [];
  let complete;
  const state = {
    guild: { name: "Test", channels: [{ id: "general", name: "general", type: 0 }] },
    users: [{ id: "alice", username: "Alice" }], selectedUserId: "alice", botConnections: 1,
    messages: { general: [] as Array<{content: string; [key: string]: unknown}> }, commands: [{ id: "ping", name: "ping", description: "Test" }],
  };
  script.runInNewContext({ ...fixture.globals, fetch: async (url) => {
    if (url === "/_ui/session") return { ok: true, json: async () => ({ csrf: "csrf", selectedUserId: "alice" }) };
    if (url === "/_ui/state") return { ok: true, json: async () => state };
    sends.push(url);
    return new Promise((resolve) => { complete = () => resolve({ ok: true, json: async () => ({ id: "created" }) }); });
  } });
  await setImmediate();
  const input = fixture.elements["message-input"];
  for (const [content, route] of [["Hello", "/_ui/messages"], ["/ping", "/_ui/interaction"]]) {
    input.value = content;
    let prevented = false;
    input.onkeydown({ key: "Enter", repeat: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    const before = sends.length;
    fixture.elements["message-form"].requestSubmit();
    fixture.elements["message-form"].requestSubmit();
    input.onkeydown({ key: "Enter", preventDefault() {} });
    assert.equal(sends.length, before + 1);
    assert.equal(sends.at(-1), route);
    complete();
    await setImmediate();
    assert.equal(fixture.elements.send.disabled, false);
  }
  input.value = "/";
  input.oninput();
  input.onkeydown({ key: "Enter", preventDefault() {} });
  const before = sends.length;
  input.onkeydown({ key: "Enter", repeat: true, preventDefault() {} });
  assert.equal(sends.length, before, "holding the completion Enter cannot execute the command");
});
