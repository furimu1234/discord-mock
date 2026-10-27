import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { MockRuntime, ServerOptions } from "../../../apps/server/src/server.js";
import { appPaths, type AppConnection } from "./config.js";
import { startEphemeralDatabase } from "./database.js";
import { createDatabaseInspector } from "./database-inspector.js";

const require = createRequire(import.meta.url);
const { startMock } = require("../../../apps/server/dist/server.cjs") as {
  startMock(options: ServerOptions): Promise<MockRuntime>;
};

interface AppOptions {
  port?: number;
  dataDir?: string;
  statePath?: string;
}

/** Own the Web/Mock and DB lifecycle, independently of any Bot process. */
export async function startApp(options: AppOptions = {}) {
  const paths = appPaths(options.dataDir);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const lock = await open(paths.lock, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`App is already running or ${paths.lock} needs recovery`);
    throw error;
  });
  let mock: MockRuntime | undefined;
  let database: Awaited<ReturnType<typeof startEphemeralDatabase>> | undefined;
  let closed = false;
  const temporaryPath = `${paths.runtime}.${randomBytes(6).toString("hex")}.tmp`;

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    const results = await Promise.allSettled([
      rm(paths.runtime, { force: true }),
      mock?.close(),
      database?.close(),
      rm(temporaryPath, { force: true }),
    ]);
    await lock.close();
    await rm(paths.lock, { force: true });
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason), "App shutdown failed");
  }

  try {
    await lock.writeFile(String(process.pid));
    await rm(paths.runtime, { force: true });
    database = await startEphemeralDatabase();
    mock = await startMock({
      port: options.port ?? 3000,
      tokenPath: paths.credentials,
      statePath: options.statePath,
      database: createDatabaseInspector(database.db),
    });
    const connection: AppConnection = { schemaVersion: 1, url: mock.url, postgresDsn: database.dsn };
    await writeFile(temporaryPath, `${JSON.stringify(connection, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, paths.runtime);
    return { mock, database, paths, close };
  } catch (error) {
    await close();
    throw error;
  }
}
