import { startApp } from "./app-runtime.js";
import { loadLocalEnvironment } from "./config.js";

async function main(): Promise<void> {
  loadLocalEnvironment();
  const app = await startApp({
    port: Number(process.env.DISCORD_MOCK_PORT ?? 3000),
    statePath: process.env.DISCORD_MOCK_STATE_PATH,
  });
  console.log(`Browser: ${app.mock.url}/test | Admin: ${app.mock.url}/admin`);
  console.log(`Database: ${app.mock.url}/database`);
  console.log(`Token JSON: ${app.paths.credentials}`);
  console.log("Set this synthetic token in the repository .env:");
  console.log(`TOKEN=${app.mock.token}`);
  console.log("Run pnpm bot in another terminal.");
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
