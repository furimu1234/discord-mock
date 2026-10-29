import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProcessLock } from "../src/process-lock.js";

const moduleUrl = new URL("../src/process-lock.ts", import.meta.url).href;
async function directory() {
  return mkdtemp(join(tmpdir(), "dismock-process-lock-"));
}
async function absent(path: string) {
  return access(path).then(
    () => false,
    () => true,
  );
}
async function deadPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("Child did not start");
  await once(child, "exit");
  return pid;
}
function startContender(path: string) {
  const source = `import {acquireProcessLock} from ${JSON.stringify(moduleUrl)};
    try {
      const release = await acquireProcessLock(${JSON.stringify(path)}, 'App');
      console.log(JSON.stringify({acquired:true, pid:process.pid}));
      const timer = setInterval(()=>{},1000);
      process.stdin.once('data', async () => { await release(); clearInterval(timer); process.stdin.destroy(); });
    } catch (error) { console.log(JSON.stringify({acquired:false, error:error.message})); }`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  const exited = once(child, "exit");
  const ready = new Promise<{
    acquired: boolean;
    pid?: number;
    error?: string;
  }>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Lock contender timed out")),
      15_000,
    );
    let output = "";
    let errors = "";
    child.stderr.on("data", (data) => {
      errors += data.toString();
    });
    child.stdout.on("data", (data) => {
      output += data.toString();
      if (output.includes("\n")) {
        clearTimeout(timeout);
        resolve(JSON.parse(output.split("\n")[0]));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", () => {
      clearTimeout(timeout);
      if (!output.includes("\n"))
        reject(new Error(errors || "Contender exited before acquiring"));
    });
  });
  return {
    child,
    ready,
    exited,
    async close() {
      if (child.exitCode === null && child.signalCode === null)
        child.stdin.end("release");
      await exited;
    },
  };
}

describe("ローカルプロセスロック", () => {
  it("稼働中のApp/Botと旧PIDファイルを保護し、正常終了後は再取得できる", async () => {
    const root = await directory();
    try {
      for (const name of ["App", "Bot"] as const) {
        const path = join(root, `${name}.lock`);
        const release = await acquireProcessLock(path, name);
        expect(await readFile(path, "utf8")).toBe(String(process.pid));
        await expect(acquireProcessLock(path, name)).rejects.toThrow(
          /already running/,
        );
        await release();
        expect(await absent(path)).toBe(true);
        const next = await acquireProcessLock(path, name);
        await release();
        await expect(acquireProcessLock(path, name)).rejects.toThrow(
          /already running/,
        );
        await next();
        await writeFile(path, String(process.pid));
        await expect(acquireProcessLock(path, name)).rejects.toThrow(
          /already running/,
        );
        expect(await readFile(path, "utf8")).toBe(String(process.pid));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("異常終了後に残った旧形式のPIDを自動回復する", async () => {
    const root = await directory();
    try {
      const pid = await deadPid();
      for (const name of ["App", "Bot"] as const) {
        const path = join(root, `${name}.lock`);
        await writeFile(path, String(pid));
        const release = await acquireProcessLock(path, name);
        expect(await readFile(path, "utf8")).toBe(String(process.pid));
        await release();
        expect(await absent(path)).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("SIGKILL後のロックを8プロセスで同時回復しても、取得できるのは1つ", async () => {
    const root = await directory();
    const path = join(root, "app.lock");
    const crashed = startContender(path);
    const contenders: ReturnType<typeof startContender>[] = [];
    try {
      expect((await crashed.ready).acquired).toBe(true);
      crashed.child.kill("SIGKILL");
      await crashed.exited;
      expect(await absent(path)).toBe(false);
      for (let index = 0; index < 8; index++)
        contenders.push(startContender(path));
      const results = await Promise.all(contenders.map((child) => child.ready));
      expect(results.filter((result) => result.acquired)).toHaveLength(1);
      const winner = results.find((result) => result.acquired);
      expect(await readFile(path, "utf8")).toBe(String(winner?.pid));
      await expect(acquireProcessLock(path, "App")).rejects.toThrow(
        /already running/,
      );
      await Promise.all(contenders.map((child) => child.close()));
      expect(await absent(path)).toBe(true);
      const release = await acquireProcessLock(path, "App");
      await release();
    } finally {
      if (crashed.child.exitCode === null && crashed.child.signalCode === null)
        crashed.child.kill("SIGKILL");
      await Promise.all(
        contenders.map((child) => {
          child.child.kill("SIGKILL");
          return child.exited;
        }),
      );
      await rm(root, { recursive: true, force: true });
    }
  }, 25_000);

  it("別のOSやPID名前空間の所有者は、PIDが見えなくても回復しない", async () => {
    const root = await directory();
    const path = join(root, "app.lock");
    const release = await acquireProcessLock(path, "App");
    try {
      const recordPath = join(`${path}.owner`, "owner.json");
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      record.scope = "another-process-namespace";
      record.pid = await deadPid();
      await writeFile(recordPath, JSON.stringify(record));
      await expect(acquireProcessLock(path, "App")).rejects.toThrow(
        /already running/,
      );
      expect(JSON.parse(await readFile(recordPath, "utf8")).scope).toBe(
        record.scope,
      );
    } finally {
      await release();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("空の解放途中ディレクトリだけを回復し、壊れた所有者情報は削除しない", async () => {
    const root = await directory();
    const path = join(root, "app.lock");
    try {
      await mkdir(`${path}.owner`);
      const release = await acquireProcessLock(path, "App");
      await release();
      await mkdir(`${path}.owner`);
      await writeFile(join(`${path}.owner`, "owner.json"), "broken");
      await expect(acquireProcessLock(path, "App")).rejects.toThrow(
        /cannot be verified/,
      );
      expect(await readFile(join(`${path}.owner`, "owner.json"), "utf8")).toBe(
        "broken",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("不正なPID・シンボリックリンク・プロセス確認の権限不足では既存ファイルを消さない", async () => {
    const root = await directory();
    const path = join(root, "bot.lock");
    try {
      for (const value of ["", "0", "-1", "not-a-pid"]) {
        await writeFile(path, value);
        await expect(acquireProcessLock(path, "Bot")).rejects.toThrow(
          /cannot be verified/,
        );
        expect(await readFile(path, "utf8")).toBe(value);
      }
      const pid = await deadPid();
      await writeFile(path, String(pid));
      const original = process.kill.bind(process);
      const kill = vi
        .spyOn(process, "kill")
        .mockImplementation((target, signal) => {
          if (target === pid)
            throw Object.assign(new Error("permission denied"), {
              code: "EPERM",
            });
          return original(target, signal);
        });
      try {
        await expect(acquireProcessLock(path, "Bot")).rejects.toThrow(
          /already running/,
        );
        expect(await readFile(path, "utf8")).toBe(String(pid));
      } finally {
        kill.mockRestore();
      }
      if (process.platform !== "win32") {
        await rm(path);
        const target = join(root, "untouched");
        await writeFile(target, String(pid));
        await symlink(target, path);
        await expect(acquireProcessLock(path, "Bot")).rejects.toThrow(
          /cannot be verified/,
        );
        expect(await readFile(target, "utf8")).toBe(String(pid));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
