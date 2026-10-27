import { startSampleBot } from "./bot.js";

const url = process.env.DISCORD_MOCK_URL ?? "http://127.0.0.1:3000";
const token = process.env.DISCORD_MOCK_TOKEN;

if (!token) {
  console.error("DISCORD_MOCK_TOKEN is required (copy the mock_ token from the local CLI).");
  process.exitCode = 1;
} else {
  void startSampleBot(url, token)
    .then((client) => {
      console.log(`Sample Bot connected to local Mock: ${url}`);
      console.log("Try the /ping interaction with the local mock admin API.");
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => {
          client.destroy();
          process.exitCode = 0;
        });
      }
    })
    .catch((error: unknown) => {
      console.error("Sample Bot failed to start:", error);
      process.exitCode = 1;
    });
}
