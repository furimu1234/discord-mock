import { botConnection, loadLocalEnvironment } from "./config.js";
import { acquireBotLock } from "./bot-lock.js";

interface LocalBotModule {
  startLevelBot(url: string, token: string, postgresDsn: string): Promise<{ close(): Promise<void> }>;
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const token = process.env.TOKEN ?? process.env.DISCORD_MOCK_TOKEN;
  if (!token) throw new Error("Set TOKEN in the repository .env using the value printed by pnpm app");
  if (!/^mock_[a-zA-Z0-9_-]{1,200}$/.test(token)) {
    throw new Error("TOKEN must be a synthetic mock_ token for pnpm bot");
  }

  const { url, postgresDsn } = await botConnection();
  const release = await acquireBotLock();
  // Load the separately built Bot after .env, without bundling its business logic again.
  const moduleUrl = new URL("../packages/bot/dist/local.mjs", import.meta.url);
  let bot: Awaited<ReturnType<LocalBotModule["startLevelBot"]>> | undefined;
  let stopping = false;
  let shutdown: Promise<void> | undefined;
  const stop = () => {
    stopping = true;
    if (!bot || shutdown) return;
    shutdown = bot.close().finally(release);
    void shutdown.catch(reportError);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
  try {
    const { startLevelBot } = await import(moduleUrl.href) as LocalBotModule;
    bot = await startLevelBot(url, token, postgresDsn);
  } catch (error) {
    await release();
    throw error;
  }
  if (stopping) { stop(); return; }
  console.log(`level_bot connected to ${url}`);
}

function reportError(error: unknown): void {
  // SDK error objects can include request details; keep credentials out of logs.
  console.error(error instanceof Error ? error.message : "Bot startup failed");
  process.exitCode = 1;
}

void main().catch(reportError);
