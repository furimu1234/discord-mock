import { startTemplateBot } from './mock';
const token = process.env.DISCORD_MOCK_TOKEN;
const url = process.env.DISCORD_MOCK_URL ?? 'http://127.0.0.1:3000';
if (!token) {
  console.error('Set DISCORD_MOCK_TOKEN to the mock_ token printed by the CLI');
  process.exitCode = 1;
} else {
  void startTemplateBot(url, token).then(({ client }) => {
    console.log('Upstream template Bot connected to local Mock at', url);
    console.log('The source MessageCreate/leveling handler is active.');
    process.once('SIGINT', () => client.destroy());
    process.once('SIGTERM', () => client.destroy());
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
