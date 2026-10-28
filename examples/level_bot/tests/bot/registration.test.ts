import { test, expect } from "vitest";
import { createBotClient } from "../../packages/bot/src/main.js";
import { createTestEnvironment } from "@discord-mock/client-js/testing";
import { registerSlashCommand } from "../../packages/bot/src/utils/register.js";

test("Ready 前のコマンド登録は通信せずにエラーにする", async () => {
  // 接続を必要としない単体テストも /test の実行ログへ結果を報告する。
  const reportUrl = process.env.DISCORD_MOCK_REPORT_URL;
  const mock = await createTestEnvironment({
    reportTo: reportUrl ? { baseUrl: reportUrl, name: "Ready 前のコマンド登録は通信せずにエラーにする" } : undefined,
  });
  const client = createBotClient();
  let succeeded = false;
  try {
    await mock.report({ step: "Ready 前のコマンド登録が拒否されることを確認" });
    await expect(
      registerSlashCommand(client, { name: "ping", description: "動作確認" }),
    ).rejects.toThrow("ClientReady");
    succeeded = true;
  } finally {
    try {
      await mock.report({ status: succeeded ? "passed" : "failed", step: succeeded ? "検証完了" : "検証失敗" });
    } finally {
      await client.destroy();
      await mock.close();
    }
  }
});
