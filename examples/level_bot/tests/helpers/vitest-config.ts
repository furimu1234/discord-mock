import { fileURLToPath } from "node:url";
import type { ViteUserConfig } from "vitest/config";
import { appPaths, readAppConnection } from "../../src/config.js";

async function reportingUrl(required: boolean): Promise<string | undefined> {
  const configured = process.env.DISCORD_MOCK_REPORT_URL;
  if (configured === "off" && !required) return;
  let candidate = configured;
  if (!candidate || candidate === "off") {
    try {
      candidate = (await readAppConnection(appPaths().runtime)).url;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "app の接続設定を読めません。pnpm app を再起動してください",
        );
      candidate = "http://127.0.0.1:3000";
    }
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("表示先はループバック HTTP の origin を指定してください");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("表示先はループバック HTTP の origin を指定してください");
  try {
    const response = await fetch(new URL("/health", url), {
      redirect: "error",
      signal: AbortSignal.timeout(1000),
    });
    const result = (await response.json()) as {
      service?: string;
      status?: string;
    };
    if (
      !response.ok ||
      result.service !== "discord-mock" ||
      result.status !== "ok"
    )
      throw new Error();
    console.info(`自動テストの表示先: ${url.origin}/tests`);
    return url.origin;
  } catch {
    if (required || configured)
      throw new Error(
        "先に pnpm app を起動してください。表示先は DISCORD_MOCK_REPORT_URL で指定できます",
      );
  }
}

export async function botTestConfig(
  requireWeb = false,
): Promise<ViteUserConfig> {
  const reportUrl = await reportingUrl(requireWeb);
  return {
    resolve: {
      alias: [
        {
          find: "@discord-mock/client-js/testing",
          replacement: fileURLToPath(
            new URL(
              "../../../../packages/client-js/dist/testing.cjs",
              import.meta.url,
            ),
          ),
        },
        {
          find: "@discord-mock/client-js",
          replacement: fileURLToPath(
            new URL(
              "../../../../packages/client-js/src/index.ts",
              import.meta.url,
            ),
          ),
        },
        {
          find: "@ex/db",
          replacement: fileURLToPath(
            new URL("../../packages/db/src/index.ts", import.meta.url),
          ),
        },
      ],
    },
    test: {
      include: ["tests/bot/**/*.test.ts"],
      environment: "node",
      fileParallelism: false,
      testTimeout: 15_000,
      hookTimeout: 30_000,
      env: { DISCORD_MOCK_REPORT_URL: reportUrl ?? "" },
    },
  };
}
