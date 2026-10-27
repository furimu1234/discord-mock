import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startTemplateBot } from '../packages/bot/dist/mock.mjs';

const require = createRequire(import.meta.url);
const { startMock } = require('../../../apps/server/dist/server.cjs');

const guildId = '123456789000000000';
const channelId = '123456789000000002';
const dummyUser = { id: '123456789000000099', username: 'TemplateTester', discriminator: '0', avatar: null, bot: false };

async function waitUntil(predicate, timeoutMs = 4500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for original template leveling handler');
}

test('upstream monorepo bot handles Mock MESSAGE_CREATE and runs original leveling+DB functions', { timeout: 10000 }, async () => {
  const mock = await startMock({ port: 0 });
  let bot;
  try {
    bot = await startTemplateBot(mock.url, mock.token);
    assert.equal(bot.client.rest.options.api, mock.url + '/api');

    // Generate the message's complete public shape using the Mock REST API.
    const created = await fetch(mock.url + '/api/v10/channels/' + channelId + '/messages', {
      method: 'POST',
      headers: { authorization: `Bot ${mock.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'seed message' }),
    });
    assert.equal(created.status, 200);
    const seed = await created.json();
    assert.equal(bot.levels.get(guildId, mock.token), undefined);

    async function sendDummy(id) {
      const response = await fetch(mock.url + '/_mock/dispatch', {
        method: 'POST',
        headers: { 'x-discord-mock-secret': mock.adminSecret, 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'MESSAGE_CREATE',
          data: { ...seed, id, guild_id: guildId, author: dummyUser, content: 'hello from a dummy user' },
        }),
      });
      assert.equal(response.status, 200);
    }

    await sendDummy('123456789000000181');
    await waitUntil(() => bot.levels.get(guildId, dummyUser.id)?.lvl === 2);
    await sendDummy('123456789000000182');
    await waitUntil(() => bot.levels.get(guildId, dummyUser.id)?.lvl === 3);
    assert.equal(bot.levels.get(guildId, dummyUser.id)?.lvl, 3);
  } finally {
    bot?.client.destroy();
    await mock.close();
  }
});

test('upstream template sample does not accept production Discord tokens', async () => {
  await assert.rejects(
    startTemplateBot('http://127.0.0.1:3000', 'not-a-mock-token'),
    /Only mock_ tokens/,
  );
});
