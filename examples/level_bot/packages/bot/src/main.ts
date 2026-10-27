import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands, commandsCollection } from './commands/main.js';
import { Container, container } from './container.js';
import { execute as onLevelingMessage } from './events/leveling.js';
import { slashCommandRegister } from './utils/register.js';

export function createBotClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
      Partials.GuildMember, Partials.User, Partials.Reaction,
      Partials.Message, Partials.Channel,
    ],
    waitGuildTimeout: 500,
  });
}

async function initializeBot(client: Client<true>): Promise<void> {
  container.current = Container();
  const logger = container.current.logger;
  logger.info('=============BOT START=============');
  logger.info(client.user.displayName);
  const commands = await loadCommands();
  await slashCommandRegister(client, commands);
}

/** Register handlers before connecting and wait for asynchronous Ready setup. */
export async function runClient(client: Client, connect: () => Promise<unknown>) {
  client.setMaxListeners(30);
  const failures: unknown[] = [];
  client.on(Events.Error, (error) => {
    failures.push(error);
    console.error('[level_bot]', error.message);
  });
  const reportFailure = (error: unknown) => {
    client.emit(Events.Error, error instanceof Error ? error : new Error(String(error)));
  };
  client.on(Events.MessageCreate, (message) => {
    void onLevelingMessage(message).catch(reportFailure);
  });
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const execute = commandsCollection.get(interaction.commandName);
    if (execute) void execute(interaction).catch(reportFailure);
  });

  const initialized = new Promise<void>((resolve, reject) => {
    client.once(Events.ClientReady, (readyClient) => {
      void initializeBot(readyClient).then(resolve, reject);
    });
  });
  await Promise.all([Promise.resolve().then(connect), initialized]);
  return { failures };
}
