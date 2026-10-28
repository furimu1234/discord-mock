import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import {
  loadCommands,
  commandsCollection,
  type CommandIssue,
} from "./commands/main.js";
import { Container, container } from "./container.js";
import { execute as onLevelingMessage } from "./events/leveling.js";
import {
  registerSlashCommand,
  slashCommandRegister,
} from "./utils/register.js";

export function createBotClient(): Client {
  return new Client({
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
    waitGuildTimeout: 500,
  });
}

async function initializeBot(
  client: Client<true>,
  onDatabaseDisconnect?: () => void,
): Promise<void> {
  container.current = Container(onDatabaseDisconnect);
  const logger = container.current.logger;
  logger.info("=============BOT START=============");
  logger.info(client.user.displayName);
  const commands = await loadCommands({
    async register(command) {
      await registerSlashCommand(client, command);
    },
    onError(issue: CommandIssue): void {
      logger.warn(
        { commandFile: issue.file, reason: issue.reason },
        "コマンドをスキップしました",
      );
    },
  });
  // 読み込みに成功したものだけを残す。削除・失敗したファイルの古い登録も除去する。
  await slashCommandRegister(client, commands);
  logger.info({ commandCount: commands.length }, "コマンドを登録しました");
}

/** Register handlers before connecting and wait for asynchronous Ready setup. */
export async function runClient(
  client: Client,
  connect: () => Promise<unknown>,
  onDatabaseDisconnect?: () => void,
) {
  client.setMaxListeners(30);
  const failures: unknown[] = [];
  client.on(Events.Error, (error) => {
    failures.push(error);
    console.error("[level_bot]", error.message);
  });
  const reportFailure = (error: unknown) => {
    client.emit(
      Events.Error,
      error instanceof Error ? error : new Error(String(error)),
    );
  };
  client.on(Events.MessageCreate, (message) => {
    void onLevelingMessage(message).catch(reportFailure);
  });
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const execute = commandsCollection.get(interaction.commandName);
    if (execute)
      void Promise.resolve()
        .then(() => execute(interaction))
        .catch(reportFailure);
  });

  const initialized = new Promise<void>((resolve, reject) => {
    client.once(Events.ClientReady, (readyClient) => {
      void initializeBot(readyClient, onDatabaseDisconnect).then(
        resolve,
        reject,
      );
    });
  });
  await Promise.all([Promise.resolve().then(connect), initialized]);
  return { failures };
}
