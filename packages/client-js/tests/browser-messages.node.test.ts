import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { once } from "node:events";
import { Client, Events, GatewayIntentBits } from "discord.js";

const { disMockClient } = await import(
  new URL("../dist/index.js", import.meta.url).href
);

const { startMock } = createRequire(import.meta.url)(
  "../../../apps/server/dist/server.cjs",
);

test(
  "JSの共通HTTP契約とdiscord.jsへのメッセージ作成・更新・削除イベントを検証する",
  { timeout: 10000 },
  async () => {
    const mock = await startMock({ port: 0 });
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      waitGuildTimeout: 200,
    });
    try {
      const ready = once(client, Events.ClientReady);
      await disMockClient(client, { baseUrl: mock.url }).connect(mock.token);
      await ready;
      const response = await fetch(`${mock.url}/_ui/session`);
      const { csrf } = await response.json();
      const headers = {
        cookie: response.headers.get("set-cookie").split(";")[0],
        "content-type": "application/json",
        "x-discord-mock-csrf": csrf,
      };
      const channel = mock.testing.channels.findByName("general");
      const onCreate = once(client, Events.MessageCreate);
      const created = await fetch(`${mock.url}/_ui/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ channel_id: channel.id, content: "JSの投稿" }),
      });
      const message = await created.json();
      assert.equal((await onCreate)[0].id, message.id);
      const url = `${mock.url}/_ui/messages/${channel.id}/${message.id}`;
      const read = await (await fetch(url, { headers })).json();
      assert.equal(read.canEdit, true);
      assert.equal(read.canDelete, true);
      const onEdit = once(client, Events.MessageUpdate);
      const edited = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ content: "JSの編集" }),
      });
      assert.equal(edited.status, 200);
      assert.equal((await edited.json()).content, "JSの編集");
      assert.equal((await onEdit)[1].content, "JSの編集");
      const onDelete = once(client, Events.MessageDelete);
      assert.equal(
        (await fetch(url, { method: "DELETE", headers })).status,
        200,
      );
      assert.equal((await onDelete)[0].id, message.id);
      assert.equal((await fetch(url, { headers })).status, 404);
    } finally {
      client.destroy();
      await mock.close();
    }
  },
);
