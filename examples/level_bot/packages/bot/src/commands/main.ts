import { Collection } from 'discord.js';
import type { commandExecute, slashCommands } from '../types.js';
import * as ping from './ping.js';

// Explicit imports survive bundling; runtime does not scan unbuilt .ts files.
const commandModules = [ping];
export const commandsCollection = new Collection<string, commandExecute>();

export async function loadCommands(): Promise<slashCommands> {
  commandsCollection.clear();
  return commandModules.map((command) => {
    commandsCollection.set(command.data.name, command.execute);
    return command.data.toJSON();
  });
}
