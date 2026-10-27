import { createRequire } from 'node:module';
import { startEphemeralDatabase } from '../dist/database.mjs';
import { startLevelBot } from '../packages/bot/dist/local.mjs';

const require = createRequire(import.meta.url);
const { startMock } = require('../../../apps/server/dist/server.cjs');
const database = await startEphemeralDatabase();
let mock;
let bot;
try {
  mock = await startMock({ port: Number(process.env.DISCORD_MOCK_PORT ?? 3000) });
  bot = await startLevelBot(mock.url, mock.token, database.dsn);
  console.log('');
  console.log('Discord Mock + level_bot is ready');
  console.log('Browser:', `${mock.url}/test`);
  console.log('Embedded PostgreSQL DSN:', database.dsn);
  console.log('Bot token:', mock.token);
  console.log('Post a message in the browser to trigger the original leveling event.');
} catch (error) {
  await bot?.close();
  await mock?.close();
  await database.close();
  throw error;
}
let closed = false;
async function shutdown() {
  if (closed) return;
  closed = true;
  await bot?.close();
  await mock?.close();
  await database.close();
}
process.once('SIGINT', () => { void shutdown().catch(console.error); });
process.once('SIGTERM', () => { void shutdown().catch(console.error); });
