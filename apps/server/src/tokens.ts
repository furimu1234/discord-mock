import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord } from "./models.js";

export function isMockToken(value: unknown): value is string {
  return typeof value === "string" && /^mock_[a-zA-Z0-9_-]{1,200}$/.test(value);
}

/** Keep synthetic credentials separate from state exposed by the admin API. */
export async function loadOrCreateToken(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("Mock token configuration is in use by another process");
    throw error;
  });
  const temporaryPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;

  try {
    let configuration: unknown;
    try {
      configuration = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Cannot read mock token JSON; the existing file was not changed");
      }
      configuration = {};
    }

    if (!isRecord(configuration) || (configuration.schemaVersion !== undefined && configuration.schemaVersion !== 1)) {
      throw new Error("Invalid mock token configuration; expected schemaVersion 1");
    }
    if (configuration.token !== undefined) {
      if (!isMockToken(configuration.token)) {
        throw new Error("Token JSON must contain a synthetic mock_ token");
      }
      return configuration.token;
    }

    const token = `mock_${randomBytes(20).toString("hex")}`;
    const contents = `${JSON.stringify({ ...configuration, schemaVersion: 1, token }, null, 2)}\n`;
    await writeAtomicToken(temporaryPath, path, contents);
    return token;
  } finally {
    try {
      await rm(temporaryPath, { force: true });
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}

async function writeAtomicToken(temporaryPath: string, path: string, contents: string): Promise<void> {
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporaryPath, path);
}
