import type { TestProject } from "vitest/node";
import { getTestClient, startEphemeralDatabase } from "dismock/e2e";

export default async function setup(project: TestProject) {
  const entry = process.env.DISMOCK_ENTRY;
  if (!entry) throw new Error("テストクライアントの実行ファイルが未指定です");
  if (
    process.env.DISCORD_MOCK_REPORT_URL &&
    process.env.DISCORD_MOCK_REPORT_URL !== "off"
  ) {
    project.provide("mockDbDsn", "");
    return;
  }
  await project.import(entry);
  const client = getTestClient(entry);
  if (!client) throw new Error("runTestClient() の設定が見つかりません");
  if (!client.options.database) {
    project.provide("mockDbDsn", "");
    return;
  }
  const database = await startEphemeralDatabase(client.options.database);
  try {
    project.provide("mockDbDsn", database.dsn);
  } catch (error) {
    await database.close();
    throw error;
  }
  return () => database.close();
}
