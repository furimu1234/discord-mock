import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { disMockClient } from '@discord-mock/client-js';
import { Container, container } from './container';
import { execute as onLevelingMessage } from './events/leveling';

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
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
      Partials.GuildMember, Partials.User, Partials.Reaction,
      Partials.Message, Partials.Channel,
    ],
    waitGuildTimeout: 500,
  });
  client.setMaxListeners(30);
  container.current = Container();
  const failures: unknown[] = [];
  client.on(Events.Error, (error) => { failures.push(error); console.error('[level_bot]', error); });
  client.on(Events.MessageCreate, (message) => {
    void onLevelingMessage(message).catch((error) => {
      failures.push(error);
      client.emit(Events.Error, error);
    });
  });
  try {
    await disMockClient(client, { baseUrl }).connect(token);
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
