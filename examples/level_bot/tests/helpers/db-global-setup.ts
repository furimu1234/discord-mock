import { startEphemeralDatabase } from "../../src/database.js";

/** CI / CLI without an app uses a single PGlite shared by every test file. */
export default async function setup({ provide }: { provide(name: "mockDbDsn", dsn: string): void }) {
  if (process.env.DISCORD_MOCK_REPORT_URL && process.env.DISCORD_MOCK_REPORT_URL !== "off") {
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
