import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import type { Logger } from 'pino';

import path from 'node:path';
import { loadCommands } from './commands/main';

import { schema } from '@ex/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Pool } from 'pg';
import { Container, container } from './container';
import { loadEvents } from './loadEvents';
import { slashCommandRegister } from './utils/register';

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessageReactions,
	],
	partials: [
		Partials.GuildMember,
		Partials.User,
		Partials.Reaction,
		Partials.Message,
		Partials.Channel,
	],
});
client.setMaxListeners(30);

let logger: Logger<never, boolean>;

loadEvents(client, path.resolve(path.dirname(__filename), './events'));

client.once(Events.ClientReady, async () => {
	container.current = Container();

	logger = container.current.logger;

	if (client.user) {
		logger.info('=============BOT START=============');
		logger.info(client.user?.displayName);
		const commands = await loadCommands();
		await slashCommandRegister(client.user, commands);

		//再起動前からVCに入ってた場合、最後に保存された起動時間と保存されてるVC入室時間をもとにexpとレベルを計算する
	}
});

client.on(Events.Error, async (error) => {
	console.error(error);
});

export const runClient = async (client: Client) => {
	const pool = new Pool({
		connectionString: process.env.PG_URL,
	});

	const db = drizzle<typeof schema>(pool, {
		schema: schema,
	});

	await migrate(db, {
		migrationsFolder: path.resolve(
			path.dirname(__filename),
			'../../../db/drizzle',
		),
		migrationsSchema: path.resolve(path.dirname(__filename), '../../db/schema'),
	});

	client.login('');
};
