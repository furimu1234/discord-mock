import { join, resolve } from "node:path";
import type { ViteUserConfig } from "vitest/config";
import { localOrigin, readE2ERuntime } from "./e2e-runtime.js";

export interface E2EConfigOptions {
  root?: string;
  /** configureE2E() を呼ぶ、利用者の既存のテスト用 Bot アダプター。 */
  setup: string | string[];
  globalSetup?: string | string[];
  runtimeFile?: string;
  requireWeb?: boolean;
  resolve?: ViteUserConfig["resolve"];
}

/** 利用側の tests にはケースだけを置き、共通の実行設定は配布物から読み込む。 */
export async function defineE2EConfig(
  options: E2EConfigOptions,
): Promise<ViteUserConfig> {
  const root = resolve(options.root ?? process.cwd());
  const runtimeFile = resolve(
    root,
    options.runtimeFile ?? ".discord-mock-data/runtime.json",
  );
  const configured = process.env.DISCORD_MOCK_REPORT_URL;
  let reportUrl: string | undefined;
  if (configured !== "off" || options.requireWeb) {
    const runtime = await readE2ERuntime(runtimeFile);
    const candidate = localOrigin(
      configured && configured !== "off"
        ? configured
        : (runtime?.url ?? "http://127.0.0.1:3000"),
    );
    try {
      const response = await fetch(new URL("/health", candidate), {
        redirect: "error",
        signal: AbortSignal.timeout(1000),
      });
      const health = (await response.json()) as {
        status?: string;
        service?: string;
      };
      if (
        !response.ok ||
        health.status !== "ok" ||
        health.service !== "discord-mock"
      )
        throw new Error();
      reportUrl = candidate;
    } catch {
      if (options.requireWeb || (configured && configured !== "off"))
        throw new Error(
          "先に App を起動してください。表示先は DISCORD_MOCK_REPORT_URL で指定できます",
        );
    }
  }
  if (reportUrl)
    console.info(`自動テストの表示先: ${reportUrl}/test・${reportUrl}/tests`);
  const setups =
    typeof options.setup === "string" ? [options.setup] : options.setup;
  return {
    root,
    resolve: options.resolve,
    test: {
      include: ["tests/**/*.test.ts"],
      environment: "node",
      fileParallelism: false,
      setupFiles: [
        ...setups.map((path) => resolve(root, path)),
        join(__dirname, "vitest-setup.mjs"),
      ],
      sequence: { setupFiles: "list" },
      globalSetup: options.globalSetup,
      testTimeout: 15_000,
      hookTimeout: 30_000,
      env: {
        DISCORD_MOCK_REPORT_URL: reportUrl ?? "",
        DISMOCK_RUNTIME_FILE: runtimeFile,
        DISMOCK_SHARED_DATABASE: options.globalSetup ? "1" : "",
        DISCORD_MOCK_SELECTED_USER_ID:
          process.env.DISCORD_MOCK_SELECTED_USER_ID ?? "123456789000000099",
      },
    },
  };
}

export interface SharedE2EDatabase {
  dsn: string;
  close(): Promise<void>;
}

/** DB の種類・スキーマは利用側が定義し、Vitest 実行全体で1つだけ所有する。 */
export function createSharedDatabaseSetup(
  start: () => Promise<SharedE2EDatabase>,
) {
  return async ({
    provide,
  }: { provide(name: "mockDbDsn", dsn: string): void }) => {
    if (
      process.env.DISCORD_MOCK_REPORT_URL &&
      process.env.DISCORD_MOCK_REPORT_URL !== "off"
    ) {
      provide("mockDbDsn", "");
      return;
    }
    const database = await start();
    try {
      provide("mockDbDsn", database.dsn);
    } catch (error) {
      await database.close();
      throw error;
    }
    return () => database.close();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    mockDbDsn: string;
  }
}
