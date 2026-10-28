import {
  startApp as startRuntimeApp,
  startEphemeralDatabase as startDatabase,
  type AppOptions,
} from "dismock/runtime";
import { databaseOptions } from "../../../../examples/level_bot/packages/bot/src/testClient.js";

const entry = new URL(
  "../../../../examples/level_bot/packages/bot/src/testClient.ts",
  import.meta.url,
);
export async function startApp(options: Omit<AppOptions, "entry"> = {}) {
  const app = await startRuntimeApp({ ...options, entry });
  const database = app.database;
  if (!database) {
    await app.close();
    throw new Error("サンプル Bot の DB 設定が必要です");
  }
  return { ...app, database };
}
export const startEphemeralDatabase = () => startDatabase(databaseOptions);
