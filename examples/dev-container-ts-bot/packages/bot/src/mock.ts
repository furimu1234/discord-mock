import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { disMockClient } from '@discord-mock/client-js';
import { container } from './container';
import { execute as onLevelingMessage } from './events/leveling';

/**
 * Test-only in-memory implementation of the small Drizzle subset used by the
 * upstream leveling handler. It avoids requiring a PostgreSQL daemon in
 * Nix-shell or GitHub Actions; production DB source is copied separately.
 */
export function createLevelStore() {
  type Level = { id: number; serverId: string; userId: string; lvl: number };
  const rows = new Map<string, Level>();
  const key = (serverId: string, userId: string) => `${serverId}:${userId}`;
  let current: Level | undefined;
  const db = {
    query: { lvl: { async findFirst() { return current; } } },
    insert() {
      return { values(value: { serverId: string; userId: string; lvl: number }) {
        return { async returning() {
          const row = { id: rows.size + 1, ...value };
          current = row;
          rows.set(key(row.serverId, row.userId), row);
          return [row];
        } };
      } };
    },
    update() {
      return { set(changes: { lvl: number }) {
        return { where() {
          return { async returning() {
            if (!current) return [];
            const next = { ...current, ...changes };
            current = next;
            rows.set(key(next.serverId, next.userId), next);
            return [next];
          } };
        } };
      } };
    },
  };
  return {
    get(serverId: string, userId: string) { return rows.get(key(serverId, userId)); },
    getDataStore() { return { do: async (fn: (db: any) => Promise<unknown>) => fn(db) }; },
  };
}

export async function startTemplateBot(
  baseUrl: string,
  token: string,
  levelStore = createLevelStore(),
) {
  if (!/^mock_[a-zA-Z0-9_-]+$/.test(token)) {
    throw new Error('Only mock_ tokens are accepted for the upstream Bot example');
  }
  // Intent / Partial configuration is retained from upstream main.ts.
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
  // Re-use the actual upstream leveling event and DB funcs without rewriting
  // its logic. Only the database driver is replaced by an in-memory test store.
  container.current = {
    logger: { info: () => {} },
    getDataStore: () => levelStore.getDataStore(),
  } as unknown as NonNullable<typeof container.current>;
  client.on(Events.MessageCreate, (message) => {
    void onLevelingMessage(message).catch((error) => {
      client.emit(Events.Error, error);
    });
  });
  try {
    await disMockClient(client, { baseUrl }).connect(token);
    return { client, levels: levelStore };
  } catch (error) {
    client.destroy();
    container.current = undefined;
    throw error;
  }
}
