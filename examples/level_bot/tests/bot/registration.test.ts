import { test, expect } from "../helpers/bot-test.js";
import { createBotClient } from "../../packages/bot/src/main.js";
import { registerSlashCommand } from "../../packages/bot/src/utils/register.js";

test("Ready 前のコマンド登録は通信せずにエラーにする", async () => {
  const client = createBotClient();
  try {
    await expect(
      registerSlashCommand(client, { name: "ping", description: "動作確認" }),
    ).rejects.toThrow("ClientReady");
  } finally {
    await client.destroy();
  }
});
