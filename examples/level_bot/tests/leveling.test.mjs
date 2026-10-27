import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { once } from 'node:events';
import { startEphemeralDatabase } from '../dist/database.mjs';
import { startLevelBot } from '../packages/bot/dist/local.mjs';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { startMock } = require('../../../apps/server/dist/server.cjs');
const guildId = '123456789000000000';
const channelId = '123456789000000002';

async function until(fn, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error('Timed out waiting for genuine PG/Drizzle leveling update');
}

test('level_bot uses the original Drizzle functions via a real in-memory PostgreSQL DSN', { timeout: 20000 }, async () => {
  const db = await startEphemeralDatabase();
  const mock = await startMock({ port: 0 });
  let bot;
  let pool;
  try {
    pool = new pg.Pool({ connectionString: db.dsn, max: 1 });
    bot = await startLevelBot(mock.url, mock.token, db.dsn);
    assert.equal(bot.client.isReady(), true);
    const registered = await bot.client.application.commands.fetch();
    assert.ok(registered.size > 0);
    assert.equal(bot.client.rest.options.api, `${mock.url}/api`);
    const sessionResponse = await fetch(`${mock.url}/_ui/session`);
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
    assert.ok(session.users.some((u) => u.id === session.selectedUserId));
    const headers = {
      cookie,
      'x-discord-mock-csrf': session.csrf,
      'content-type': 'application/json',
    };
    for (let i = 0; i < 2; i++) {
      const sent = await fetch(`${mock.url}/_ui/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel_id: channelId, content: `Hello from browser ${i}` }),
      });
      assert.equal(sent.status, 201);
      const message = await sent.json();
      assert.equal(message.author.id, session.selectedUserId);
      await until(async () => {
        const result = await pool.query(
          'SELECT lvl FROM example.lvl WHERE server_id = $1 AND user_id = $2',
          [guildId, session.selectedUserId],
        );
        return result.rows[0]?.lvl === i + 2;
      });
    }
    const ui = await (await fetch(`${mock.url}/_ui/state`, { headers: { cookie } })).json();
    assert.equal(ui.messages[channelId].length, 2);
    assert.equal(ui.botConnections, 1);
    const command = ui.commands[0];
    assert.ok(command);
    assert.equal(registered.get(command.id)?.name, command.name);
    let replyCount = 0;
    for (const actor of session.users) {
      const identity = await fetch(`${mock.url}/_ui/identity`, {
        method: 'POST', headers, body: JSON.stringify({ user_id: actor.id }),
      });
      assert.equal(identity.status, 200);
      const pending = once(bot.client, 'interactionCreate', { signal: AbortSignal.timeout(5000) });
      const pendingReply = once(bot.client, 'messageCreate', { signal: AbortSignal.timeout(5000) });
      const response = await fetch(`${mock.url}/_ui/interaction`, {
        method: 'POST', headers,
        body: JSON.stringify({ channel_id: channelId, command_id: command.id, user_id: 'ignored-spoofed-user' }),
      });
      assert.equal(response.status, 201);
      const [interaction] = await pending;
      assert.equal(interaction.isChatInputCommand(), true);
      assert.equal(interaction.user.id, actor.id);
      assert.equal(interaction.commandId, command.id);
      assert.equal(interaction.commandName, command.name);
      const [sdkReply] = await pendingReply;
      assert.equal(sdkReply.author.bot, true);
      assert.equal(sdkReply.interactionMetadata.user.id, actor.id);
      assert.equal(sdkReply.interactionMetadata.id, interaction.id);
      replyCount++;
      await until(async () => {
        const view = await (await fetch(`${mock.url}/_ui/state`, { headers: { cookie } })).json();
        const replies = view.messages[channelId].filter((message) => message.author.bot && message.content.trim());
        if (replies.length !== replyCount) return false;
        assert.equal(replies.at(-1).interaction.user.id, actor.id);
        assert.equal(replies.at(-1).interaction.name, command.name);
        assert.equal(replies.at(-1).interaction_metadata.id, interaction.id);
        return true;
      });
    }
    assert.equal(bot.failures.length, 0);
  } finally {
    await bot?.close();
    await pool?.end();
    await mock.close();
    await db.close();
  }
});

test('local runner rejects production Discord tokens without connecting', async () => {
  await assert.rejects(
    startLevelBot('http://127.0.0.1:3000', 'not-mock', 'postgresql://postgres@127.0.0.1/test'),
    /Only synthetic mock_/,
  );
});
