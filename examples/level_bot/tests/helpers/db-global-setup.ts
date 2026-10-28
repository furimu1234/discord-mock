import type { GlobalSetupContext } from "vitest/node";
import { startEphemeralDatabase } from "../../src/database.js";

/** CI / CLI without an app uses a single PGlite shared by every test file. */
export default async function setup({ provide }: GlobalSetupContext) {
  if (process.env.DISCORD_MOCK_REPORT_URL) {
    provide("mockDbDsn", "");
    return;
  }
  const database = await startEphemeralDatabase();
  provide("mockDbDsn", database.dsn);
  return async () => { await database.close(); };
}

declare module "vitest" {
  export interface ProvidedContext {
    mockDbDsn: string;
  }
}
