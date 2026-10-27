import { MakeDataStore, schema } from '@ex/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import pino from 'pino';
import { ENV } from './env.js';
import type { ContainerRef } from './types.js';

export const Container = () => {
  const logger = pino({
    transport: {
      target: 'pino-pretty',
      level: 'info',
      options: { colorize: true, translateTime: 'yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' },
    },
  });
  // A single pg.Pool for the lifetime of the bot, not a new pool per message.
  // PostgreSQL and the embedded DSN both use the same unmodified Drizzle path.
  const pool = new Pool({ connectionString: ENV.POST_URL, max: 1 });
  const db = drizzle<typeof schema>(pool, { schema });

  return {
    logger,
    getDataStore: () => MakeDataStore(db),
    close: () => pool.end(),
  };
};

export const container: ContainerRef = { current: undefined };
