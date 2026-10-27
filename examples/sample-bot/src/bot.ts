import { Client, Events, GatewayIntentBits } from "discord.js";
import { disMockClient } from "@discord-mock/client-js";

/**
 * A real discord.js Client running against discord-mock only.
 * No real Discord bot token is required or accepted by this entry point.
 */
export async function startSampleBot(
  baseUrl: string,
  mockToken: string,
): Promise<Client> {
  if (!/^mock_[a-zA-Z0-9_-]+$/.test(mockToken)) {
    throw new Error("Only a local mock_ token is allowed");
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    waitGuildTimeout: 500,
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "ping") return;

    try {
      await interaction.reply({ content: "Pong! 🦈" });
    } catch (error) {
      console.error("Failed to reply to the mock /ping interaction:", error);
    }
  });

  try {
    const mock = disMockClient(client, { baseUrl });
    await mock.connect(mockToken);
    return client;
  } catch (error) {
    client.destroy();
    throw error;
  }
}
