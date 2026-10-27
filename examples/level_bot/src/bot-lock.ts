import { mkdir, open, rm } from "node:fs/promises";
import { appPaths } from "./config.js";

/** One pnpm bot per app data directory; never connect a duplicate SDK process. */
export async function acquireBotLock(): Promise<() => Promise<void>> {
  const paths = appPaths();
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const lock = await open(paths.botLock, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`Bot is already running; stop the existing pnpm bot first. If it crashed, recover ${paths.botLock} after checking the process has stopped.`);
    throw error;
  });
  const release = async () => {
    await lock.close();
    await rm(paths.botLock, { force: true });
  };
  try { await lock.writeFile(String(process.pid)); }
  catch (error) { await release(); throw error; }
  return release;
}
