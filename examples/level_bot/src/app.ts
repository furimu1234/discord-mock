import { startApp } from "./app-runtime.js";
import { loadLocalEnvironment } from "./config.js";

async function main(): Promise<void> {
  loadLocalEnvironment();
  const app = await startApp({
    port: Number(process.env.DISCORD_MOCK_PORT ?? 3000),
    statePath: process.env.DISCORD_MOCK_STATE_PATH,
    autoStartBot: process.env.DISCORD_MOCK_AUTOSTART_BOT !== "off",
  });
  console.log(`Browser: ${app.mock.url}/test | Admin: ${app.mock.url}/admin`);
  console.log(`Database: ${app.mock.url}/database`);
  console.log(`Token JSON: ${app.paths.credentials}`);
  console.log("Set this synthetic token in the repository .env:");
  console.log(`TOKEN=${app.mock.token}`);
  console.log(app.botStartup);
  console.log("テスト実行: pnpm bot（個別テストは /test 下部のボタン）");
  console.log("Bot 単体起動（必要な場合のみ）: pnpm bot:client");
  console.log("PGlite is in memory; its data lasts until pnpm app stops.");
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    // pnpm can forward a signal already delivered to the whole process group.
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void app.close().catch(reportError);
    });
  }
}

function reportError(error: unknown): void {
  console.error(error instanceof Error ? error.message : "App failed");
  process.exitCode = 1;
}

void main().catch(reportError);
