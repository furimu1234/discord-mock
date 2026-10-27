import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function loadLocalEnvironment(): void {
  const path = process.env.DISCORD_MOCK_ENV_FILE ?? resolve(repositoryRoot, ".env");
  try {
    loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Cannot read the local environment file");
    }
  }
}

export function appPaths(dataDir = process.env.DISCORD_MOCK_DATA_DIR) {
  const directory = resolve(repositoryRoot, dataDir ?? ".discord-mock-data");
  return {
    directory,
    credentials: resolve(directory, "credentials.json"),
    runtime: resolve(directory, "runtime.json"),
    lock: resolve(directory, "app.lock"),
    botLock: resolve(directory, "bot.lock"),
  };
}

export interface AppConnection {
  schemaVersion: 1;
  url: string;
  postgresDsn: string;
}

function localUrl(value: unknown, protocols: string[]): string {
  if (typeof value !== "string") throw new Error("Missing local connection URL");
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Mock connections must use loopback URLs");
  }
  if (url.protocol === "http:" && (url.username || url.password || url.pathname !== "/" || url.search || url.hash)) {
    throw new Error("Mock HTTP URL must be a plain loopback origin");
  }
  return value;
}

export async function readAppConnection(path: string): Promise<AppConnection> {
  const configuration: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !configuration || typeof configuration !== "object" ||
    !("schemaVersion" in configuration) || configuration.schemaVersion !== 1 ||
    !("url" in configuration) || !("postgresDsn" in configuration)
  ) {
    throw new Error("Invalid app runtime JSON");
  }
  return {
    schemaVersion: 1,
    url: localUrl(configuration.url, ["http:"]),
    postgresDsn: localUrl(configuration.postgresDsn, ["postgresql:", "postgres:"]),
  };
}

export async function botConnection(): Promise<AppConnection> {
  try {
    const connection = await readAppConnection(appPaths().runtime);
    if (process.env.DISCORD_MOCK_URL) {
      connection.url = localUrl(process.env.DISCORD_MOCK_URL, ["http:"]);
    }
    return connection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Cannot read app connection settings; restart pnpm app");
    }
    if (!process.env.POST_URL) throw new Error("Start pnpm app before pnpm bot");
    return {
      schemaVersion: 1,
      url: localUrl(process.env.DISCORD_MOCK_URL ?? "http://127.0.0.1:3000", ["http:"]),
      postgresDsn: localUrl(process.env.POST_URL, ["postgresql:", "postgres:"]),
    };
  }
}
