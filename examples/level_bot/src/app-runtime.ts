import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { MockRuntime, ServerOptions } from "../../../apps/server/src/server.js";
import { appPaths, repositoryRoot, type AppConnection } from "./config.js";
import { LocalTestCaseRunner } from "./test-case-runner.js";
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
  autoStartBot?: boolean;
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
  let botProcess: ChildProcess | undefined;
  let botStartup = "Bot の自動起動を待機中";
  let currentUrl = "";
  const testCases = new LocalTestCaseRunner(() => currentUrl);
  const temporaryPath = `${paths.runtime}.${randomBytes(6).toString("hex")}.tmp`;

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    // 子 Bot は Mock/DB を停止する前に終了要求する。
    if (botProcess && botProcess.exitCode === null && botProcess.signalCode === null)
      botProcess.kill("SIGTERM");
    const results = await Promise.allSettled([
      testCases.close(),
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
    // トークンが新規作成された初回起動では、Bot を勝手に起動しない。
    const hadCredentials = await readFile(paths.credentials, "utf8").then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    database = await startEphemeralDatabase();
    mock = await startMock({
      port: options.port ?? 3000,
      tokenPath: paths.credentials,
      statePath: options.statePath,
      database: createDatabaseInspector(database.db),
      testCases,
    });
    const connection: AppConnection = { schemaVersion: 1, url: mock.url, postgresDsn: database.dsn };
    await writeFile(temporaryPath, `${JSON.stringify(connection, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, paths.runtime);
    currentUrl = mock.url;
    if (options.autoStartBot && hadCredentials) {
      const configuredToken = process.env.TOKEN ?? process.env.DISCORD_MOCK_TOKEN;
      if (configuredToken && configuredToken !== mock.token) {
        botStartup = "Bot のトークンが JSON と異なるため、自動起動を中止しました";
        console.error("[level_bot] TOKEN が credentials.json と一致しません。設定を確認し、pnpm bot:test を実行してください。");
      } else {
        // tsx を直接起動して子プロセスを確実に管理する（OS 固有の pnpm.cmd は経由しない）。
        const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
        botProcess = spawn(process.execPath, [
          tsxCli, "--tsconfig", "packages/bot/tsconfig.json", "src/bot.ts",
        ], {
          cwd: join(repositoryRoot, "examples/level_bot"),
          env: {
            ...process.env,
            TOKEN: mock.token,
            DISCORD_MOCK_DATA_DIR: paths.directory,
          },
          stdio: "inherit",
        });
        botStartup = "保存済みトークンで Bot クライアントを起動しています";
        botProcess.on("error", () => {
          botStartup = "Bot の起動に失敗しました";
          console.error("[level_bot] Bot を起動できません。pnpm install と pnpm bot:test を確認してください。");
        });
        botProcess.on("exit", (code) => {
          if (!closed && code !== 0) {
            botStartup = "Bot クライアントが異常終了しました";
            console.error("[level_bot] Bot が異常終了しました。設定を確認し、pnpm bot:test を実行してください。");
          }
        });
      }
    } else if (options.autoStartBot) {
      botStartup = "初回起動: credentials.json にトークンを保存しました。次回から自動起動します";
    }
    return { mock, database, paths, close, get botStartup() { return botStartup; } };
  } catch (error) {
    await close();
    throw error;
  }
}
