import { startLevelBot } from './local';
const token = process.env.DISCORD_MOCK_TOKEN;
const url = process.env.DISCORD_MOCK_URL ?? 'http://127.0.0.1:3000';
const dsn = process.env.POST_URL;
if (!token || !dsn) {
  console.error('Set DISCORD_MOCK_TOKEN and POST_URL before starting level_bot; pnpm demo configures both automatically.');
  process.exitCode = 1;
} else {
  void startLevelBot(url, token, dsn).then((bot) => {
    console.log('level_bot connected to', url, 'using PostgreSQL DSN');
    process.once('SIGINT', () => { void bot.close(); });
    process.once('SIGTERM', () => { void bot.close(); });
  }).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
