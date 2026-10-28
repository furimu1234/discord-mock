import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { startMock } = createRequire(import.meta.url)("../dist/server.cjs");
const channel = "123456789000000002";

test("Bot REST accepts text embeds and rejects invalid or unsupported input without saving it", async () => {
  const mock = await startMock({ port: 0 });
  const headers = { authorization: `Bot ${mock.token}`, "content-type": "application/json" };
  const send = (body) => fetch(`${mock.url}/api/v10/channels/${channel}/messages`, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    const response = await send({ embeds: [{ title: "Level", color: 0, fields: [{ name: "Current level", value: "3", inline: true }], footer: { text: "by テスター" } }] });
    assert.equal(response.status, 200);
    const message = await response.json();
    assert.equal(message.content, "");
    assert.deepEqual(message.embeds, [{ type: "rich", title: "Level", color: 0, fields: [{ name: "Current level", value: "3", inline: true }], footer: { text: "by テスター" } }]);
    const boundary = {
      title: "t".repeat(256), description: "d".repeat(4096),
      fields: [{ name: "n".repeat(256), value: "v".repeat(1024) }, { name: "n".repeat(256), value: "v".repeat(112) }],
    };
    assert.equal((await send({ embeds: [boundary] })).status, 200, "6000 combined characters are accepted");
    for (const body of [
      {}, { content: 1 }, { content: "x".repeat(2001) }, { embeds: null }, { embeds: {} },
      { embeds: [{ title: {} }] }, { embeds: [{}] }, { embeds: [{ title: " " }] },
      { embeds: Array(11).fill({ title: "x" }) },
      { embeds: [{ title: "x".repeat(257) }] },
      { embeds: [{ description: "x".repeat(4097) }] },
      { embeds: [{ footer: { text: "x".repeat(2049) } }] },
      { embeds: [{ footer: { text: " " } }] },
      { embeds: [{ footer: { text: "x", icon_url: "https://example.invalid/icon.png" } }] },
      { embeds: [{ ...boundary, footer: { text: "x" } }] },
      { embeds: [{ title: "x", fields: Array(26).fill({ name: "n", value: "v" }) }] },
      { embeds: [{ fields: [{ name: "x".repeat(257), value: "v" }] }] },
      { embeds: [{ fields: [{ name: "n", value: "x".repeat(1025) }] }] },
      { embeds: [{ fields: [{ name: "n", value: "v", inline: "true" }] }] },
      { embeds: [{ ...boundary, title: "t".repeat(256), fields: [...boundary.fields, { name: "x", value: "y" }] }] },
      { embeds: [{ title: "x", color: -1 }] }, { embeds: [{ title: "x", color: 0x1000000 }] },
      { embeds: [{ title: "x", color: "red" }] }, { embeds: [{ title: "x", type: "image" }] },
      { embeds: [{ title: "x", image: { url: "https://example.invalid/not-fetched.png" } }] },
    ]) {
      const rejected = await send(body);
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).code, 50035);
    }
    const messages = await (await fetch(`${mock.url}/api/v10/channels/${channel}/messages`, { headers })).json();
    assert.equal(messages.length, 2);
  } finally { await mock.close(); }
});
