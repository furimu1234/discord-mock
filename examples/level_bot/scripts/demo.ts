import { createRequire } from 'node:module';
const { startEphemeralDatabase } = await import(new URL('../dist/database.mjs', import.meta.url).href) as typeof import('../src/database.js');
import { startLevelBot } from '../packages/bot/src/local.ts';

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
