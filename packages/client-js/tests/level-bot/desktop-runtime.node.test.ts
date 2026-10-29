import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
test(
  "CLIはElectronへ認証済みの接続情報を通知し、プロジェクトの管理・テスト・DBを提供する",
  { timeout: 40_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "dismock-desktop-runtime-"));
    const file = join(directory, "connection.json");
    const nonce = randomBytes(16).toString("hex");
    const env = { ...process.env };
    for (const key of [
      "TOKEN",
      "DISCORD_MOCK_TOKEN",
      "DISCORD_MOCK_URL",
      "DISCORD_MOCK_STATE_PATH",
      "DISCORD_MOCK_TOKEN_PATH",
    ])
      Reflect.deleteProperty(env, key);
    const entry = fileURLToPath(
      new URL(
        "../../../../examples/level_bot/packages/bot/src/testClient.ts",
        import.meta.url,
      ),
    );
    const tsconfig = fileURLToPath(
      new URL(
        "../../../../examples/level_bot/packages/bot/tsconfig.json",
        import.meta.url,
      ),
    );
    const child = spawn(
      process.execPath,
      [require.resolve("tsx/cli"), "--tsconfig", tsconfig, entry],
      {
        env: {
          ...env,
          DISCORD_MOCK_PORT: "0",
          DISCORD_MOCK_DATA_DIR: directory,
          DISMOCK_DESKTOP_CONNECTION_FILE: file,
          DISMOCK_DESKTOP_CONNECTION_NONCE: nonce,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = once(child, "exit");
    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
    });
    try {
      let raw: string | undefined;
      for (let attempt = 0; attempt < 400; attempt++) {
        raw = await readFile(file, "utf8").catch(() => undefined);
        if (raw) break;
        if (child.exitCode !== null)
          throw new Error("テストクライアントが接続通知前に終了しました");
        await delay(50);
      }
      assert.ok(raw, "接続通知を受信できる");
      const connection = JSON.parse(raw) as {
        schemaVersion: number;
        nonce: string;
        url: string;
        adminSession: string;
      };
      assert.equal(connection.schemaVersion, 1);
      assert.equal(connection.nonce === nonce, true);
      assert.match(connection.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const headers = {
        cookie: `discord_mock_admin=${connection.adminSession}`,
      };
      const session = (await fetch(`${connection.url}/_admin/ui/session`, {
        headers,
      }).then((r) => r.json())) as { authenticated: boolean; csrf: string };
      assert.equal(session.authenticated, true);
      assert.equal(
        (await fetch(`${connection.url}/_admin/ui/state`)).status,
        401,
      );
      const update = await fetch(`${connection.url}/_admin/ui/guild`, {
        method: "PATCH",
        headers: {
          ...headers,
          "content-type": "application/json",
          "x-discord-mock-csrf": session.csrf,
        },
        body: JSON.stringify({ name: "Desktop project" }),
      });
      assert.equal(update.status, 200);
      const state = (await fetch(`${connection.url}/_admin/ui/state`, {
        headers,
      }).then((r) => r.json())) as { guild: { name: string } };
      assert.equal(state.guild.name, "Desktop project");
      const login = await fetch(`${connection.url}/_admin/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-mock-local": "1",
        },
        body: "{}",
      });
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const cases = (await fetch(`${connection.url}/_admin/test-cases`, {
        headers: { cookie },
      }).then((r) => r.json())) as { cases: unknown[] };
      assert.ok(cases.cases.length > 0);
      assert.equal(
        (
          await fetch(`${connection.url}/_admin/database/tables`, {
            headers: { cookie },
          })
        ).status,
        200,
      );
      assert.equal(
        output.includes(connection.adminSession),
        false,
        "管理セッションをログに出さない",
      );
      assert.equal(
        output.includes(nonce),
        false,
        "起動要求のnonceをログに出さない",
      );
      child.kill("SIGTERM");
      assert.equal((await exited)[0], 0);
      await assert.rejects(readFile(join(directory, "app.lock")), {
        code: "ENOENT",
      });
      assert.equal(
        JSON.parse(await readFile(join(directory, "state.json"), "utf8")).guild
          .name,
        "Desktop project",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
