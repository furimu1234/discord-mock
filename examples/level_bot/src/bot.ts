import { botConnection, loadLocalEnvironment } from "./config.js";
import { acquireBotLock } from "./bot-lock.js";
import { monitorApp } from "./app-monitor.js";
import { shutdownBot } from "./bot-shutdown.js";

interface LocalBotModule {
  startLevelBot(url: string, token: string, postgresDsn: string, options?: { onDatabaseDisconnect?: () => void }): Promise<{ close(): Promise<void> }>;
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
  // .env と TOKEN の検証後に Bot の TS ソースを読み込む。
  const moduleUrl = new URL("../packages/bot/src/local.ts", import.meta.url);
  let bot: Awaited<ReturnType<LocalBotModule["startLevelBot"]>> | undefined;
  let stopping = false;
  let shutdown: Promise<void> | undefined;
  let stopMonitor = () => {};
  const stop = () => {
    stopping = true;
    stopMonitor();
    if (!bot || shutdown) return;
    const activeBot = bot;
    shutdown = shutdownBot(() => activeBot.close(), release);
    void shutdown.then(() => finish(0), (error) => { reportError(error); finish(1); });
  };
  const disconnected = () => {
    if (stopping) return;
    console.log("app との接続が切れたため Bot を終了します。再開時は pnpm app → pnpm bot の順に起動してください。");
    stop();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
  try {
    const { startLevelBot } = await import(moduleUrl.href) as LocalBotModule;
    bot = await startLevelBot(url, token, postgresDsn, { onDatabaseDisconnect: disconnected });
  } catch (error) {
    await release();
    throw error;
  }
  if (stopping) { stop(); return; }
  stopMonitor = monitorApp(url, disconnected);
  console.log(`level_bot connected to ${url}`);
}

function finish(code: number): void {
  // 接続・ロックの後始末後に、この CLI が持つ SDK の再接続タイマーも終了する。
  process.stdout.write("", () => { process.stderr.write("", () => process.exit(code)); });
}

function reportError(error: unknown): void {
  // SDK error objects can include request details; keep credentials out of logs.
  console.error(error instanceof Error ? error.message : "Bot startup failed");
  process.exitCode = 1;
}

void main().catch(reportError);
