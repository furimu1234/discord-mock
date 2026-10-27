import { REST, Routes, type User } from 'discord.js';
import { ENV } from '../env';
import type { slashCommands } from '../types';

export async function slashCommandRegister(
	clientUser: User,
	commands: slashCommands,
) {
	const rest = new REST().setToken(ENV.TOKEN);
	await rest.put(Routes.applicationCommands(clientUser.id), {
		body: commands,
	});
}
