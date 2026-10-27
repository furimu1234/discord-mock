import fs from 'node:fs';
import path from 'node:path';

import {
	Collection,
	type RESTPostAPIChatInputApplicationCommandsJSONBody,
	type SlashCommandBuilder,
} from 'discord.js';
import type { commandExecute, slashCommands } from '../types';


const __dirname = path.dirname(__filename);

export const commandsCollection = new Collection<string, commandExecute>();

export async function loadCommands(): Promise<slashCommands> {
	const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
	const foldersPath = path.join(__dirname, './');

	const commandFiles = fs
		.readdirSync(foldersPath)
		.filter((file) => file !== 'main.ts' && file.endsWith('.ts'));
	for (const file of commandFiles) {
		const filePath = path.join('./', file);
		const command: { data: SlashCommandBuilder; execute: commandExecute } =
			await import(`${foldersPath}${filePath}`);

		if ('data' in command && 'execute' in command) {
			commands.push(command.data.toJSON());
			commandsCollection.set(command.data.name, command.execute);
		} else {
			console.log(
				`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
			);
		}
	}

	return commands;
}
