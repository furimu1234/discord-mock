import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs") as typeof import("../src/server.js");

test("Create Messageのrich Embedの全主要フィールドを保存してMessageとして返す", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const channelId = mock.testing.channels.findByName("general")?.id;
    assert.ok(channelId);
    const headers = { authorization: `Bot ${mock.token}`, "content-type": "application/json" };
    const embed = {
      title: "タイトル", description: "説明", url: "https://example.org",
      color: 0x123456, timestamp: "2026-10-28T00:00:00.000Z",
      author: { name: "作者", url: "https://example.org", icon_url: "https://example.org/icon.png" },
      footer: { text: "フッター", icon_url: "https://example.org/footer.png" },
      image: { url: "https://example.org/image.png" },
      thumbnail: { url: "https://example.org/thumbnail.png" },
      fields: [{ name: "レベル", value: "5", inline: true }],
    };
    const input = { content: "テスト", tts: true, embeds: [embed], nonce: "nonce-01",
      flags: 4 | 4096, allowed_mentions: { parse: [] } };
    const response = await fetch(`${mock.url}/api/v10/channels/${channelId}/messages`, {
      method: "POST", headers, body: JSON.stringify(input),
    });
    assert.equal(response.status, 200);
    const message = await response.json();
    assert.equal(message.content, input.content);
    assert.equal(message.tts, true);
    assert.equal(message.flags, input.flags);
    assert.equal(message.nonce, "nonce-01");
    assert.deepEqual(message.embeds[0].fields, embed.fields);
    assert.equal(message.embeds[0].image.url, embed.image.url);
    assert.equal(message.embeds[0].thumbnail.url, embed.thumbnail.url);
    assert.equal(message.embeds[0].footer.icon_url, embed.footer.icon_url);
    assert.equal(message.embeds[0].author.name, embed.author.name);
    assert.equal(message.embeds[0].timestamp, embed.timestamp);
    assert.equal(message.guild_id, mock.testing.guild.id);
    assert.equal(message.edited_timestamp, null);
    assert.deepEqual(message.attachments, []);
    assert.deepEqual(message.mentions, []);
    assert.deepEqual(message.mention_roles, []);
    assert.equal(message.pinned, false);
    assert.equal(message.type, 0);
    const get = await fetch(`${mock.url}/api/v10/channels/${channelId}/messages/${message.id}`, { headers });
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), message);
    const list = await (await fetch(`${mock.url}/api/v10/channels/${channelId}/messages`, { headers })).json();
    assert.deepEqual(list, [message]);
  } finally { await mock.close(); }
});

test("返信参照・許可メンション・nonce重複排除とforwardのスナップショット", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const ch = mock.testing.channels.findByName("general")?.id;
    assert.ok(ch);
    const url = `${mock.url}/api/v10/channels/${ch}/messages`;
    const headers = { authorization: `Bot ${mock.token}`, "content-type": "application/json" };
    const send = async (body: unknown) => {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await send({ content: "最初" });
    const alice = mock.testing.users.findByName("Alice");
    assert.ok(alice);
    const reply = await send({
      content: `<@${alice.id}> @everyone`,
      allowed_mentions: { parse: ["users"] },
      message_reference: { message_id: first.id },
      nonce: 22, enforce_nonce: true,
    });
    assert.equal(reply.type, 19);
    assert.equal(reply.referenced_message.id, first.id);
    assert.deepEqual(reply.mentions.map((user: { id: string }) => user.id), [alice.id]);
    assert.equal(reply.mention_everyone, false);
    assert.equal(reply.message_reference.message_id, first.id);
    const again = await send({
      content: `<@${alice.id}> @everyone`,
      allowed_mentions: { parse: ["users"] },
      message_reference: { message_id: first.id },
      nonce: 22, enforce_nonce: true,
    });
    assert.equal(again.id, reply.id);
    const forwarded = await send({ message_reference: { type: 1, message_id: first.id } });
    assert.equal(forwarded.message_snapshots[0].message.content, "最初");
    assert.equal((await (await fetch(url, { headers })).json()).length, 3);
  } finally { await mock.close(); }
});

test("components v1/v2、poll、ステッカー、添付ファイルのJSONメタデータをMessageに反映する", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const ch = mock.testing.channels.findByName("general")?.id;
    assert.ok(ch);
    const url = `${mock.url}/api/v10/channels/${ch}/messages`;
    const headers = { authorization: `Bot ${mock.token}`, "content-type": "application/json" };
    const create = async (body: unknown) => {
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(r.status, 200);
      return r.json();
    };
    const components = [{ type: 1, components: [{ type: 2, style: 1, label: "クリック", custom_id: "hello" }] }];
    const withComponents = await create({ components, flags: 32768 });
    assert.deepEqual(withComponents.components, components);
    assert.equal(withComponents.flags, 32768);
    const poll = { question: { text: "好きな色は？" }, answers: [{ poll_media: { text: "青" } }, { poll_media: { text: "赤" } }], duration: 24, allow_multiselect: false };
    const sticker = "123456789000000020";
    const msg = await create({
      poll, sticker_ids: [sticker], attachments: [{ id: "0", filename: "test.txt", description: "説明" }],
    });
    assert.deepEqual(msg.poll, poll);
    assert.deepEqual(msg.sticker_items, [{ id: sticker, name: "Mock Sticker", format_type: 1 }]);
    assert.deepEqual(msg.attachments, [{ id: "0", filename: "test.txt", description: "説明" }]);
  } finally { await mock.close(); }
});

test("不正なCreate Message入力を400で拒否し、メッセージを追加しない", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const ch = mock.testing.channels.findByName("general")?.id;
    assert.ok(ch);
    const url = `${mock.url}/api/v10/channels/${ch}/messages`;
    const headers = { authorization: `Bot ${mock.token}`, "content-type": "application/json" };
    const invalid = [
      {}, { content: "x".repeat(2001) },
      { content: "x", nonce: "a".repeat(26) },
      { content: "x", flags: 64 },
      { content: "x", tts: "true" },
      { content: "x", allowed_mentions: { parse: ["unknown"] } },
      { content: "x", sticker_ids: Array(4).fill("123456789000000020") },
      { content: "x", components: ["invalid"] },
      { content: "x", embeds: [{ title: "x", color: -1 }] },
      { content: "x", embeds: [{ title: "x", fields: [{ name: "", value: "a" }] }] },
      { content: "x", embeds: [{ title: "x", image: { url: false } }] },
      { content: "x", message_reference: { message_id: "not-an-id" } },
      { content: "x", flags: 32768, components: [{ type: 1 }] },
      { content: "x", undocumented_property: true },
    ];
    for (const body of invalid) {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    }
    const list = await (await fetch(url, { headers })).json();
    assert.deepEqual(list, []);
  } finally { await mock.close(); }
});

test("Discord標準のmultipart files[n]とpayload_jsonで実ファイルを保存・取得する", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const ch = mock.testing.channels.findByName("general")?.id;
    assert.ok(ch);
    const url = `${mock.url}/api/v10/channels/${ch}/messages`;
    const form = new FormData();
    form.set("payload_json", JSON.stringify({
      content: "添付をテスト",
      attachments: [{ id: "0", filename: "demo.txt", description: "テストファイル" }],
    }));
    form.set("files[0]", new Blob(["Hello from Mock"], { type: "text/plain" }), "demo.txt");
    const result = await fetch(url, {
      method: "POST", headers: { authorization: `Bot ${mock.token}` }, body: form,
    });
    assert.equal(result.status, 200);
    const message = await result.json();
    assert.equal(message.content, "添付をテスト");
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].filename, "demo.txt");
    assert.equal(message.attachments[0].description, "テストファイル");
    assert.equal(message.attachments[0].size, 15);
    assert.equal(message.attachments[0].content_type, "text/plain");
    assert.match(message.attachments[0].url, /^http:\/\/127\.0\.0\.1:\d+\/api\/v10\/mock-attachments\/\d+$/);
    const download = await fetch(message.attachments[0].url);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "text/plain");
    assert.equal(await download.text(), "Hello from Mock");
    const get = await fetch(`${url}/${message.id}`, { headers: { authorization: `Bot ${mock.token}` } });
    assert.deepEqual((await get.json()).attachments, message.attachments);

    const onlyFile = new FormData();
    onlyFile.set("files[0]", new Blob(["ok"], { type: "text/plain" }), "only.txt");
    const second = await fetch(url, {
      method: "POST", headers: { authorization: `Bot ${mock.token}` }, body: onlyFile,
    });
    assert.equal(second.status, 200);
    const secondMessage = await second.json();
    assert.equal(secondMessage.content, "");
    assert.equal(secondMessage.attachments.length, 1);

    const invalid = new FormData();
    invalid.set("files[10]", new Blob(["x"]), "invalid.txt");
    assert.equal((await fetch(url, {
      method: "POST", headers: { authorization: `Bot ${mock.token}` }, body: invalid,
    })).status, 400);
  } finally { await mock.close(); }
});
