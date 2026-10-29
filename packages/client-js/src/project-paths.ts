import { access, realpath, stat } from "node:fs/promises";
import { dirname, resolve, parse } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { readE2ERuntime, localOrigin } from "./e2e-runtime.js";
import { acquireProcessLock } from "./process-lock.js";

export function entryPath(value: string | URL): string {
  return value instanceof URL || String(value).startsWith("file:")
    ? fileURLToPath(value)
    : resolve(value);
}
export async function projectRoot(entry: string): Promise<string> {
  let directory = dirname(entry);
  let nearest: string | undefined;
  while (true) {
    const manifest = await stat(resolve(directory, "package.json")).then(
      (value) => value.isFile(),
      () => false,
    );
    if (manifest) {
      nearest ??= directory;
      if (
        await stat(resolve(directory, "tests")).then(
          (value) => value.isDirectory(),
          () => false,
        )
      )
        return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return nearest ?? dirname(entry);
    directory = parent;
  }
}
export function appPaths(dataDir?: string, root = process.cwd()) {
  const directory = resolve(
    root,
    dataDir ?? process.env.DISCORD_MOCK_DATA_DIR ?? ".discord-mock-data",
  );
  return {
    directory,
    credentials: resolve(directory, "credentials.json"),
    runtime: resolve(directory, "runtime.json"),
    lock: resolve(directory, "app.lock"),
    botLock: resolve(directory, "bot.lock"),
  };
}
export async function loadLocalEnvironment(root: string): Promise<void> {
  if (process.env.DISCORD_MOCK_ENV_FILE) {
    try {
      loadEnvFile(process.env.DISCORD_MOCK_ENV_FILE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Cannot read the local environment file");
    }
    return;
  }
  for (let directory = root; ; directory = dirname(directory)) {
    const file = resolve(directory, ".env");
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    ) {
      loadEnvFile(file);
      return;
    }
    if (
      directory === parse(directory).root ||
      (await access(resolve(directory, ".git")).then(
        () => true,
        () => false,
      ))
    )
      return;
  }
}
export async function isEntry(entry: string): Promise<boolean> {
  if (!process.argv[1]) return false;
  const [file, executable] = await Promise.all([
    realpath(entry),
    realpath(resolve(process.argv[1])).catch(() => ""),
  ]);
  return file === executable;
}
export async function acquireBotLock(
  root: string,
): Promise<() => Promise<void>> {
  const paths = appPaths(undefined, root);
  return acquireProcessLock(paths.botLock, "Bot");
}
export async function botConnection(root: string) {
  const connection = await readE2ERuntime(appPaths(undefined, root).runtime);
  if (connection)
    return {
      ...connection,
      url: process.env.DISCORD_MOCK_URL
        ? localOrigin(process.env.DISCORD_MOCK_URL)
        : connection.url,
    };
  if (!process.env.POST_URL)
    throw new Error("Start the local App before connecting a Bot");
  // 通常の接続設定と同じ検証を行い、URLの入力をログに含めない。
  const value = process.env.POST_URL;
  let database: URL;
  try {
    database = new URL(value);
  } catch {
    throw new Error("Mock connections must use loopback URLs");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
    ["host", "hostaddr", "service", "servicefile"].some((key) =>
      database.searchParams.has(key),
    )
  )
    throw new Error("Mock connections must use loopback URLs");
  return {
    url: localOrigin(process.env.DISCORD_MOCK_URL ?? "http://127.0.0.1:3000"),
    postgresDsn: value,
  };
}
