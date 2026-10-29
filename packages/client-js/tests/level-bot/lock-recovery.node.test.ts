import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startApp } from "./built-app.js";

test(
  "Mockの強制終了後は同じ保存先で再起動でき、稼働中の二重起動は拒否する",
  { timeout: 40_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "dismock-app-recovery-"));
    const runtime = fileURLToPath(
      new URL("../../dist/project-runtime.cjs", import.meta.url),
    );
    const entry = fileURLToPath(
      new URL(
        "../../../../examples/level_bot/packages/bot/src/testClient.ts",
        import.meta.url,
      ),
    );
    const source = `const {startApp} = require(${JSON.stringify(runtime)});
    startApp({entry:${JSON.stringify(entry)}, dataDir:${JSON.stringify(directory)}, port:0}).then(() => {
      console.log('ready'); setInterval(()=>{},1000);
    }).catch(error=>{console.error(error.message);process.exitCode=1;});`;
    const child = spawn(process.execPath, ["-e", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    let restarted: Awaited<ReturnType<typeof startApp>> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Mock startup timed out")),
          20_000,
        );
        child.stdout.on("data", (data) => {
          if (String(data).includes("ready")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("exit", () => {
          clearTimeout(timer);
          reject(new Error("Mock exited before becoming ready"));
        });
      });
      const credentials = await readFile(join(directory, "credentials.json"));
      await assert.rejects(
        startApp({ dataDir: directory, port: 0 }),
        /already running/,
      );
      child.kill("SIGKILL");
      await exited;
      assert.equal(
        (await readFile(join(directory, "app.lock"), "utf8")).trim(),
        String(child.pid),
      );
      restarted = await startApp({ dataDir: directory, port: 0 });
      assert.equal((await fetch(`${restarted.mock.url}/health`)).status, 200);
      assert.equal(
        credentials.equals(await readFile(join(directory, "credentials.json"))),
        true,
        "ロック回復で認証情報を作り直さない",
      );
      await assert.rejects(
        startApp({ dataDir: directory, port: 0 }),
        /already running/,
      );
      await restarted.close();
      await assert.rejects(readFile(join(directory, "app.lock")), {
        code: "ENOENT",
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
      await restarted?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
