import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  appPaths,
  acquireBotLock,
  botConnection,
  entryPath,
  loadLocalEnvironment,
} from "./project-paths.js";
import { getTestClient, type RegisteredTestClient } from "./project-entry.js";
import {
  startEphemeralDatabase,
  type EmbeddedDatabase,
} from "./embedded-database.js";
import { createDatabaseInspector } from "./database-inspector.js";
import { startLocalMock, type LocalMockRuntime } from "./testing.js";
import { monitorApp } from "./app-monitor.js";
import { shutdownBot } from "./bot-shutdown.js";
export { startEphemeralDatabase } from "./embedded-database.js";
export type * from "./embedded-database.js";
export {
  createDatabaseInspector,
  captureTestDatabase,
} from "./database-inspector.js";
export type * from "./database-types.js";
export { appPaths, loadLocalEnvironment } from "./project-paths.js";
export { monitorApp } from "./app-monitor.js";
export { getTestClient } from "./project-entry.js";

const moduleFile =
  typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url);
const require = createRequire(moduleFile);
const moduleDirectory = dirname(moduleFile);
const assets =
  basename(moduleDirectory) === "src"
    ? resolve(moduleDirectory, "../dist")
    : moduleDirectory;
export const projectVitestConfig = join(assets, "project-vitest-config.mjs");
export const projectGlobalSetup = join(assets, "project-global-setup.mjs");

async function nearestTsconfig(entry: string): Promise<string | undefined> {
  for (let path = dirname(entry); ; path = dirname(path)) {
    const file = resolve(path, "tsconfig.json");
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      return file;
    if (dirname(path) === path) return;
  }
}
export async function loadTestClient(
  value: string | URL,
): Promise<RegisteredTestClient> {
  const entry = entryPath(value);
  const cached = getTestClient(entry);
  if (cached) return cached;
  if (/\.[cm]?tsx?$/.test(entry)) {
    const { tsImport } = await import("tsx/esm/api");
    await tsImport(pathToFileURL(entry).href, {
      parentURL: pathToFileURL(moduleFile).href,
      tsconfig: await nearestTsconfig(entry),
    });
  } else await import(pathToFileURL(entry).href);
  const project = getTestClient(entry);
  if (!project)
    throw new Error(
      "実行ファイルから runTestClient(import.meta.url, options) を呼んでください",
    );
  return project;
}
function entryCommand(project: RegisteredTestClient, args: string[]) {
  if (!/\.[cm]?tsx?$/.test(project.entry)) return [project.entry, ...args];
  const tsx = require.resolve("tsx/cli");
  const configuration = project.options.tsconfig
    ? ["--tsconfig", resolve(project.root, project.options.tsconfig)]
    : [];
  return [tsx, ...configuration, project.entry, ...args];
}
function testEnvironment(
  project: RegisteredTestClient,
  paths: ReturnType<typeof appPaths>,
): NodeJS.ProcessEnv {
  return {
    DISMOCK_ENTRY: project.entry,
    DISMOCK_PROJECT_ROOT: project.root,
    DISMOCK_RUNTIME_FILE: paths.runtime,
  };
}
async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done();
    }, 3000);
    child.once("close", () => {
      clearTimeout(timer);
      done();
    });
    child.kill("SIGTERM");
  });
}

export interface AppOptions {
  entry: string | URL;
  port?: number;
  dataDir?: string;
  statePath?: string;
  autoStartBot?: boolean;
  alwaysStartBot?: boolean;
}
/** ファイル名・リポジトリ構成を固定せず、所有者のローカル App を起動する。 */
export async function startApp(options: AppOptions) {
  const project = await loadTestClient(options.entry);
  const { LocalTestCaseRunner } = await import("dismock/e2e/runner");
  const paths = appPaths(options.dataDir, project.root);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const lock = await open(paths.lock, "wx", 0o600).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST")
        throw new Error(
          `App is already running or ${paths.lock} needs recovery`,
        );
      throw error;
    },
  );
  let database: EmbeddedDatabase | undefined;
  let mock: LocalMockRuntime | undefined;
  let botProcess: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let botStartup = "Bot の自動起動を待機中";
  let currentUrl = "";
  const testCases = new LocalTestCaseRunner(() => currentUrl, {
    root: project.root,
    configFile: projectVitestConfig,
    env: testEnvironment(project, paths),
  });
  const temporary = `${paths.runtime}.${randomBytes(6).toString("hex")}.tmp`;
  const close = () => {
    closed ??= (async () => {
      await stopChild(botProcess);
      const results = await Promise.allSettled([
        testCases.close(),
        rm(paths.runtime, { force: true }),
        mock?.close(),
        database?.close(),
        rm(temporary, { force: true }),
      ]);
      try {
        await lock.close();
      } finally {
        await rm(paths.lock, { force: true });
      }
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length)
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          "App shutdown failed",
        );
    })();
    return closed;
  };
  try {
    await lock.writeFile(String(process.pid));
    await rm(paths.runtime, { force: true });
    const hadCredentials = await readFile(paths.credentials).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (project.options.database)
      database = await startEphemeralDatabase(project.options.database);
    mock = await startLocalMock({
      port: options.port ?? 3000,
      tokenPath: paths.credentials,
      statePath: options.statePath,
      database: database ? createDatabaseInspector(database.db) : undefined,
      testCases,
    });
    const connection = {
      schemaVersion: 1,
      url: mock.url,
      ...(database ? { postgresDsn: database.dsn } : {}),
    };
    await writeFile(temporary, `${JSON.stringify(connection, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, paths.runtime);
    currentUrl = mock.url;
    if (options.autoStartBot && (hadCredentials || options.alwaysStartBot)) {
      const token = process.env.TOKEN ?? process.env.DISCORD_MOCK_TOKEN;
      if (!options.alwaysStartBot && token && token !== mock.token) {
        botStartup =
          "Bot のトークンが JSON と異なるため、自動起動を中止しました";
        console.error(
          "[dismock] TOKEN が credentials.json と一致しません。設定を確認してください。",
        );
      } else {
        botProcess = spawn(process.execPath, entryCommand(project, ["--bot"]), {
          cwd: project.root,
          env: {
            ...process.env,
            TOKEN: mock.token,
            DISCORD_MOCK_DATA_DIR: paths.directory,
          },
          stdio: "inherit",
        });
        botStartup = "ローカル Bot クライアントを起動しています";
        botProcess.on("error", () => {
          botStartup = "Bot の起動に失敗しました";
          console.error("[dismock] テストクライアントを起動できません");
        });
        botProcess.on("exit", (code) => {
          if (!closed && code !== 0) {
            botStartup = "Bot クライアントが異常終了しました";
            console.error("[dismock] Bot が異常終了しました");
          }
        });
      }
    } else if (options.autoStartBot)
      botStartup =
        "初回起動: credentials.json にトークンを保存しました。次回から自動起動します";
    return {
      mock,
      database,
      paths,
      close,
      get botStartup() {
        return botStartup;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

function finish(code: number): void {
  process.stdout.write("", () =>
    process.stderr.write("", () => process.exit(code)),
  );
}
async function runBot(project: RegisteredTestClient): Promise<void> {
  await loadLocalEnvironment(project.root);
  const token = process.env.TOKEN ?? process.env.DISCORD_MOCK_TOKEN;
  if (!token || !/^mock_[a-zA-Z0-9_-]{1,200}$/.test(token))
    throw new Error("TOKEN must be a synthetic mock_ token for the local Bot");
  const connection = await botConnection(project.root);
  const release = await acquireBotLock(project.root);
  let running: Awaited<ReturnType<typeof project.options.bot>> | undefined;
  let stopping = false;
  let closing: Promise<void> | undefined;
  let stopMonitor = () => {};
  const stop = () => {
    stopping = true;
    stopMonitor();
    if (!running || closing) return;
    const active = running;
    closing = shutdownBot(() => active.close(), release);
    void closing.then(
      () => finish(0),
      () => {
        console.error("Bot の終了処理に失敗しました");
        finish(1);
      },
    );
  };
  const disconnected = () => {
    if (stopping) return;
    console.log("app との接続が切れたため Bot を終了します。");
    stop();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
  try {
    running = await project.options.bot({
      url: connection.url,
      token,
      databaseDsn: connection.postgresDsn,
      onDisconnect: disconnected,
    });
  } catch (error) {
    await release();
    throw error;
  }
  if (stopping) {
    stop();
    return;
  }
  stopMonitor = monitorApp(connection.url, disconnected);
  console.log(
    `${project.options.name ?? "Bot"} connected to ${connection.url}`,
  );
}
async function runTests(
  project: RegisteredTestClient,
  args: string[],
  web: boolean,
): Promise<void> {
  const tests = await realpath(resolve(project.root, "tests"));
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--testNamePattern" || argument === "-t") {
      const pattern = args[++index];
      if (!pattern || pattern.length > 10_000)
        throw new Error("テスト名のパターンが不正です");
    } else {
      if (argument.startsWith("-"))
        throw new Error(
          "テスト実行にはファイルと --testNamePattern のみ指定できます",
        );
      const file = await realpath(resolve(project.root, argument));
      const path = relative(tests, file);
      if (
        isAbsolute(path) ||
        path === ".." ||
        path.startsWith(`..${sep}`) ||
        !file.endsWith(".test.ts")
      )
        throw new Error("tests 配下のテストファイルを指定してください");
    }
  }
  const local = createRequire(resolve(project.root, "package.json"));
  const vitest = resolve(
    dirname(local.resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const paths = appPaths(undefined, project.root);
  const child = spawn(
    process.execPath,
    [vitest, "run", "--config", projectVitestConfig, ...args],
    {
      cwd: project.root,
      env: {
        ...process.env,
        ...testEnvironment(project, paths),
        DISMOCK_REQUIRE_WEB: web ? "1" : "",
      },
      stdio: "inherit",
    },
  );
  const stop = () => {
    child.kill("SIGTERM");
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  try {
    const code = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("close", (code) => done(code ?? 1));
    });
    process.exitCode = code;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"])
      process.removeListener(signal, stop);
  }
}

/** runTestClient が直接実行と判定した CLI だけで、シグナルとプロセス終了を扱う。 */
export async function executeTestClient(
  project: RegisteredTestClient,
  args: string[],
): Promise<void> {
  const mode = args[0];
  if (mode === "--test" || mode === "--test-web")
    return runTests(project, args.slice(1), mode === "--test-web");
  if (mode === "--bot") {
    if (args.length !== 1)
      throw new Error("--bot に追加の引数は指定できません");
    return runBot(project);
  }
  if (mode && mode !== "--app")
    throw new Error(
      "使用方法: <実行ファイル> [--app | --bot | --test | --test-web]",
    );
  if (args.length > 1) throw new Error("起動設定は環境変数で指定してください");
  await loadLocalEnvironment(project.root);
  const app = await startApp({
    entry: project.entry,
    port: Number(process.env.DISCORD_MOCK_PORT ?? 3000),
    statePath: process.env.DISCORD_MOCK_STATE_PATH,
    autoStartBot: process.env.DISCORD_MOCK_AUTOSTART_BOT !== "off",
    alwaysStartBot: !mode,
  });
  console.log(`Browser: ${app.mock.url}/test | Admin: ${app.mock.url}/admin`);
  console.log(`Database: ${app.mock.url}/database`);
  console.log(`Token JSON: ${app.paths.credentials}`);
  console.log(app.botStartup);
  console.log(
    "テスト実行: 起動ファイルに --test を付けて実行（個別テストは /test から実行）",
  );
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void app.close().then(
        () => finish(0),
        () => {
          console.error("App の終了処理に失敗しました");
          finish(1);
        },
      );
    });
}
