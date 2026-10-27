import { disMockClient } from '@discord-mock/client-js';
import { container } from './container.js';
import { createBotClient, runClient } from './main.js';

/**
 * Local runner only: the application handler and DB access code are the
 * originals; PostgreSQL is accessed over a real DSN through pg.Pool + Drizzle.
 * There is no in-memory fake Drizzle driver or monkeypatch in the Bot.
 */
export async function startLevelBot(baseUrl: string, token: string, postgresDsn: string) {
  if (!/^mock_[a-zA-Z0-9_-]+$/.test(token)) {
    throw new Error('Only synthetic mock_ tokens are allowed in the local runner');
  }
  if (!/^postgres(ql)?:\/\/[^\s]+$/.test(postgresDsn)) {
    throw new Error('A PostgreSQL connection string is required');
  }
  process.env.POST_URL = postgresDsn;
  const client = createBotClient();
  try {
    const { failures } = await runClient(client, () => disMockClient(client, { baseUrl }).connect(token));
    return {
      client,
      failures,
      async close() {
        client.destroy();
        await container.current?.close();
        container.current = undefined;
      },
    };
  } catch (error) {
    client.destroy();
    await container.current?.close();
    container.current = undefined;
    throw error;
  }
}
