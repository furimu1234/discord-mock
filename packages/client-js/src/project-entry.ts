import { resolve } from "node:path";
import {
  configureE2E,
  type E2EOptions,
  type E2ERunningBot,
} from "./e2e-context.js";
import { entryPath, isEntry, projectRoot } from "./project-paths.js";
import type { EmbeddedDatabaseOptions } from "./embedded-database.js";
declare const __DISMOCK_BUNDLE__: boolean;

export interface BotConnection {
  url: string;
  token: string;
  databaseDsn?: string;
  onDisconnect?: () => void;
}
export interface TestClientOptions<Extensions extends object = object> {
  name?: string;
  root?: string;
  tsconfig?: string;
  database?: EmbeddedDatabaseOptions;
  bot(connection: BotConnection): Promise<E2ERunningBot>;
  extend?: E2EOptions<Extensions>["extend"];
  environment?: E2EOptions<Extensions>["environment"];
  channel?: string;
}
export interface RegisteredTestClient {
  entry: string;
  root: string;
  options: TestClientOptions<object>;
}
const KEY = Symbol.for("dismock.projects.v1");
const host = process as typeof process & {
  [KEY]?: Map<string, RegisteredTestClient>;
};
function registry() {
  host[KEY] ??= new Map();
  return host[KEY];
}
export function getTestClient(
  entry: string | URL,
): RegisteredTestClient | undefined {
  return registry().get(entryPath(entry));
}

/** import時は設定登録のみ。直接実行された任意名のファイルだけを起動する。 */
export async function runTestClient<Extensions extends object>(
  entryUrl: string | URL,
  options: TestClientOptions<Extensions>,
): Promise<void> {
  const entry = entryPath(entryUrl);
  const root = options.root ? resolve(options.root) : await projectRoot(entry);
  if (typeof options.bot !== "function")
    throw new TypeError("テスト用 Bot の起動関数を指定してください");
  const project: RegisteredTestClient = { entry, root, options };
  registry().set(entry, project);
  configureE2E({
    start: ({ mock, databaseDsn }) =>
      options.bot({ url: mock.url, token: mock.botToken, databaseDsn }),
    extend: options.extend,
    environment: options.environment,
    channel: options.channel,
  });
  if (!(await isEntry(entry))) return;
  try {
    const runtime =
      typeof __DISMOCK_BUNDLE__ === "undefined"
        ? await import("./project-runtime.js")
        : await import("dismock/runtime");
    await runtime.executeTestClient(project, process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Test client startup failed",
    );
    process.exitCode = 1;
  }
}
