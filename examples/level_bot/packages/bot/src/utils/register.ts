import { Routes, type Client } from "discord.js";
import type { SlashCommandDefinition, slashCommands } from "../types.js";

function commandRoute(client: Client) {
  if (!client.isReady())
    throw new Error("コマンド登録は ClientReady の後に実行してください");
  const api = new URL(client.rest.options.api);
  if (
    api.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(api.hostname) ||
    !client.token?.startsWith("mock_")
  ) {
    throw new Error("Command registration requires a local Mock connection");
  }
  return Routes.applicationCommands(client.application.id);
}

export async function slashCommandRegister(
  client: Client,
  commands: slashCommands,
) {
  await client.rest.put(commandRoute(client), {
    body: commands,
  });
}

export async function registerSlashCommand(
  client: Client,
  command: SlashCommandDefinition,
): Promise<void> {
  await client.rest.post(commandRoute(client), { body: command });
}
