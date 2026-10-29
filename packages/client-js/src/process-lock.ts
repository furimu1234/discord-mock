import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostname } from "node:os";

interface Owner {
  version: 1;
  pid: number;
  token: string;
  scope: string;
}
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
const contention = (error: unknown) =>
  ["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );

/** signal=0 はプロセスを終了しない。存在しないことを確認できた場合だけ false。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
function validPid(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= 0x7fffffff
  );
}
async function processScope(): Promise<string> {
  const host = `${process.platform}:${hostname()}`;
  if (process.platform !== "linux") return host;
  const namespace = await readlink("/proc/self/ns/pid").catch(() => "unknown");
  return `${host}:${namespace}`;
}
async function text(path: string): Promise<string> {
  const before = await lstat(path);
  if (!before.isFile()) throw new Error("Invalid process lock");
  const file = await open(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.ino !== before.ino ||
      info.dev !== before.dev ||
      info.size > 1024
    )
      throw new Error("Invalid process lock");
    const data = Buffer.alloc(1025);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead > 1024) throw new Error("Invalid process lock");
    return data.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
}
async function owner(directory: string): Promise<Owner> {
  const info = await lstat(directory);
  if (!info.isDirectory()) throw new Error("Invalid process lock directory");
  const value = JSON.parse(
    await text(join(directory, "owner.json")),
  ) as Partial<Owner>;
  if (
    value.version !== 1 ||
    !validPid(value.pid) ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{32}$/.test(value.token) ||
    typeof value.scope !== "string" ||
    value.scope.length > 512
  )
    throw new Error("Invalid process lock owner");
  return value as Owner;
}

/**
 * 完成済みの非空ディレクトリを rename して所有権を取得する。
 * 回復した世代は非空のまま残す。同じ古い世代を見た別プロセスの rename が
 * 新しい所有者のロックを移動してしまうことを、移動先の衝突で防ぐ。
 */
export async function acquireProcessLock(
  path: string,
  name: "App" | "Bot",
): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const guard = `${path}.owner`;
  const recovered = `${path}.recovered`;
  const temporary = await mkdtemp(`${guard}.tmp-`);
  const current: Owner = {
    version: 1,
    pid: process.pid,
    token: randomBytes(16).toString("hex"),
    scope: await processScope(),
  };
  let published = false;
  const busy = () =>
    new Error(
      `${name} is already running (or its process cannot be checked): ${path}`,
    );
  const invalid = () =>
    new Error(
      `${name} lock owner cannot be verified; check running processes before recovering ${path}`,
    );
  try {
    await writeFile(join(temporary, "owner.json"), JSON.stringify(current), {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(join(temporary, "pid"), String(process.pid), {
      mode: 0o600,
      flag: "wx",
    });
    for (let attempt = 0; attempt < 32; attempt++) {
      try {
        await rename(temporary, guard);
        published = true;
        break;
      } catch (error) {
        if (!contention(error)) throw error;
      }
      let previous: Owner;
      try {
        previous = await owner(guard);
      } catch (error) {
        if (!missing(error)) throw invalid();
        // 正常解放の最後で空になったディレクトリだけを削除する。
        try {
          await rmdir(guard);
        } catch (cleanupError) {
          if (!missing(cleanupError) && !contention(cleanupError))
            throw invalid();
        }
        continue;
      }
      if (
        previous.scope !== current.scope ||
        current.scope.endsWith(":unknown") ||
        alive(previous.pid)
      )
        throw busy();
      // PID確認中に正常終了・次の取得が進んだ場合は、新しい世代を触らない。
      try {
        if ((await owner(guard)).token !== previous.token) continue;
      } catch (error) {
        if (missing(error)) continue;
        throw invalid();
      }
      await mkdir(recovered, { recursive: true, mode: 0o700 });
      if (!(await lstat(recovered)).isDirectory()) throw invalid();
      try {
        await rename(guard, join(recovered, previous.token));
      } catch (error) {
        if (!missing(error) && !contention(error)) throw error;
      }
    }
    if (!published) throw busy();
  } finally {
    if (!published) await rm(temporary, { recursive: true, force: true });
  }

  const pidFile = join(guard, "pid");
  const identity = await lstat(pidFile);
  let releasing: Promise<void> | undefined;
  const release = () => {
    releasing ??= (async () => {
      // 旧形式のPIDファイルも維持し、旧バージョンとの二重起動を防ぐ。
      try {
        const entry = await lstat(path);
        if (
          entry.isFile() &&
          entry.ino === identity.ino &&
          entry.dev === identity.dev
        )
          await unlink(path);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      try {
        if ((await owner(guard)).token !== current.token) return;
        await unlink(pidFile);
        await unlink(join(guard, "owner.json"));
        // 空になった後に次の取得が進んでも、非空ディレクトリは削除しない。
        try {
          await rmdir(guard);
        } catch (error) {
          if (!missing(error) && !contention(error)) throw error;
        }
      } catch (error) {
        if (!missing(error)) throw error;
      }
    })();
    return releasing;
  };
  try {
    for (let attempt = 0; attempt < 32; attempt++) {
      try {
        // PIDを完全に書いてから公開するため、強制終了でも空のロックを作らない。
        await link(pidFile, path);
        return release;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      let value: string;
      try {
        value = (await text(path)).trim();
      } catch (error) {
        if (missing(error)) continue;
        throw invalid();
      }
      const pid = /^\d+$/.test(value) ? Number(value) : Number.NaN;
      if (!validPid(pid)) throw invalid();
      if (alive(pid)) throw busy();
      // この削除は上の所有権で直列化済み。新旧バージョンとも次の公開は排他的。
      await unlink(path).catch((error) => {
        if (!missing(error)) throw error;
      });
    }
    throw busy();
  } catch (error) {
    await release();
    throw error;
  }
}
