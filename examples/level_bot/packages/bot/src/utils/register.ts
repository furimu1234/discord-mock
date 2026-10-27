import { Routes, type Client } from 'discord.js';
import type { slashCommands } from '../types';

export async function slashCommandRegister(
	client: Client<true>,
	commands: slashCommands,
) {
	const api = new URL(client.rest.options.api);
	if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) || !client.token?.startsWith('mock_')) {
		throw new Error('Command registration requires a local Mock connection');
	}
	await client.rest.put(Routes.applicationCommands(client.application.id), {
		body: commands,
	});
}
