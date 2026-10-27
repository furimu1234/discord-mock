import { APPLICATION_ID } from "./fixtures.js";
import { isRecord, type MockApplicationCommand } from "./models.js";

export interface CommandInput {
  name: string;
  description: string;
}

export class CommandValidationError extends Error {}

export function parseCommand(value: unknown): CommandInput {
  if (!isRecord(value)) throw new CommandValidationError("Command must be a JSON object");
  if (value.type !== undefined && value.type !== 1) {
    throw new CommandValidationError("Only CHAT_INPUT commands are supported");
  }
  if (
    typeof value.name !== "string" ||
    !/^[-_\u02BC\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u.test(value.name) ||
    value.name !== value.name.toLowerCase()
  ) {
    throw new CommandValidationError("Invalid command name");
  }
  if (typeof value.description !== "string" || value.description.length < 1 || value.description.length > 100) {
    throw new CommandValidationError("Command description must be 1..100 characters");
  }
  if (value.options !== undefined && (!Array.isArray(value.options) || value.options.length !== 0)) {
    throw new CommandValidationError("Command options are not implemented yet");
  }
  if (value.default_member_permissions != null || value.default_permission === false || value.nsfw === true) {
    throw new CommandValidationError("Command permission restrictions are not implemented yet");
  }
  for (const field of ["contexts", "integration_types"]) {
    const contexts = value[field];
    if (contexts != null && (!Array.isArray(contexts) || !contexts.includes(0))) {
      throw new CommandValidationError("Only commands available in guilds are supported");
    }
  }
  return { name: value.name, description: value.description };
}

export function parseCommandList(value: unknown): CommandInput[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new CommandValidationError("Expected an array of at most 100 commands");
  }
  const commands = value.map(parseCommand);
  if (new Set(commands.map((command) => command.name)).size !== commands.length) {
    throw new CommandValidationError("Duplicate command name");
  }
  return commands;
}

export function restoreCommands(value: unknown, guildId: string): MockApplicationCommand[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) throw new CommandValidationError("Invalid saved commands");
  const ids = new Set<string>();
  const names = new Set<string>();
  const scopeCounts = new Map<string, number>();
  return value.map((command: unknown) => {
    const input = parseCommand(command);
    if (
      !isRecord(command) || command.type !== 1 || command.application_id !== APPLICATION_ID ||
      typeof command.id !== "string" || !/^\d{17,20}$/.test(command.id) ||
      typeof command.version !== "string" || !/^\d{17,20}$/.test(command.version) ||
      (command.guild_id !== undefined && command.guild_id !== guildId)
    ) {
      throw new CommandValidationError("Invalid saved command identity or scope");
    }
    const key = `${command.guild_id ?? "global"}:${command.name}`;
    if (ids.has(command.id) || names.has(key)) throw new CommandValidationError("Duplicate saved command");
    ids.add(command.id);
    names.add(key);
    const scope = command.guild_id ?? "global";
    const count = (scopeCounts.get(scope) ?? 0) + 1;
    if (count > 100) throw new CommandValidationError("Too many saved commands in one scope");
    scopeCounts.set(scope, count);
    return {
      ...input,
      id: command.id,
      application_id: APPLICATION_ID,
      ...(command.guild_id === guildId ? { guild_id: guildId } : {}),
      type: 1,
      options: [],
      version: command.version,
    };
  });
}
