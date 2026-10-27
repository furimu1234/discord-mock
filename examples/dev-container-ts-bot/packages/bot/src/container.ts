import { MakeDataStore, schema } from '@ex/db';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import pino from 'pino';
import { ENV } from './env.ts';
import type { ContainerRef } from './types.ts';

export const Container = () => {
	const logger = pino({
		transport: {
			target: 'pino-pretty',
			level: 'info',
			options: {
				colorize: true,
				translateTime: 'yyyy-mm-dd HH:MM:ss',
				ignore: 'pid,hostname',
			},
		},
	});

	const getDataStore = () => {
		const pool = new Pool({
			connectionString: ENV.POST_URL,
		});

		const client = drizzle<typeof schema>(pool, {
			schema: schema,
		});

		const dataStore = MakeDataStore(client);
		return dataStore;
	};

	return {
		logger,
		getDataStore,
	};
};

export const container: ContainerRef = { current: undefined };
