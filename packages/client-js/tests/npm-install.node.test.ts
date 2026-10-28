import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

test(
  "npm pack を別プロジェクトへインストールし、変更なしの Bot と TS 型定義を利用できる",
  { timeout: 60_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mock-npm-"));
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const env = {
      ...process.env,
      npm_config_cache: join(directory, "cache"),
      npm_config_offline: "true",
    };
    try {
      const { stdout } = await run(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
        { cwd: packageDirectory, env },
      );
      const [{ filename }] = JSON.parse(stdout) as Array<{ filename: string }>;
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ private: true, type: "module" }),
      );
      await run(
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--omit=optional",
          join(directory, filename),
        ],
        { cwd: directory, env },
      );
      const installed = JSON.parse(
        await readFile(
          join(directory, "node_modules/dismock/package.json"),
          "utf8",
        ),
      ) as { name: string; exports: Record<string, unknown> };
      assert.equal(installed.name, "dismock");
      assert.ok(installed.exports["./client"]);
      assert.ok(installed.exports["./e2e"]);
      // SDK と Node 型は利用者側の依存。Mock パッケージ自体は tarball の内容だけを使う。
      const modules = join(directory, "node_modules");
      await symlink(
        fileURLToPath(new URL("../node_modules/discord.js", import.meta.url)),
        join(modules, "discord.js"),
        "junction",
      );
      await mkdir(join(modules, "@types"), { recursive: true });
      await symlink(
        dirname(require.resolve("@types/node/package.json")),
        join(modules, "@types/node"),
        "junction",
      );
      const vitestDirectory = dirname(require.resolve("vitest/package.json"));
      await symlink(vitestDirectory, join(modules, "vitest"), "junction");
      await mkdir(join(modules, "@electric-sql"), { recursive: true });
      for (const dependency of [
        "tsx",
        "@electric-sql/pglite",
        "@electric-sql/pglite-socket",
      ]) {
        await symlink(
          fileURLToPath(
            new URL(`../node_modules/${dependency}`, import.meta.url),
          ),
          join(modules, dependency),
          "junction",
        );
      }
      const botFile = join(directory, "main.ts");
      const original = `
import { Client, Events, GatewayIntentBits } from "discord.js";
export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages], waitGuildTimeout: 200 });
export const failures: unknown[] = [];
client.on(Events.Error, error => { failures.push(error); });
client.on(Events.MessageCreate, message => {
  if (!message.author.bot) void message.channel.send("返信").catch(error => failures.push(error));
});
export async function main() {
  await client.login(process.env.TOKEN);
  return { failures, label: "元の Bot" };
}
`;
      await writeFile(botFile, original);
      await writeFile(
        join(directory, "testClient.ts"),
        `
import assert from "node:assert/strict";
import * as disMock from "dismock/client";
import { createTestEnvironment } from "dismock/e2e";
import { client, main } from "./main.ts";
const mock = await createTestEnvironment();
const login = client.login;
try {
  const start = disMock.Client(client, main, { baseUrl: mock.url });
  const result = await start(mock.botToken);
  const label: string = result.label;
  assert.equal(label, "元の Bot");
  assert.equal(client.login, login);
  assert.equal(client.token, mock.botToken);
  const user = mock.users.findByName("Alice")!;
  const channel = mock.channels.findByName("general")!;
  const sent = await mock.as(user).sendMessage(channel.id, "こんにちは");
  const reply = await mock.messages.waitFor({ channelId: channel.id, afterId: sent.id }, message => message.author.bot);
  assert.equal(reply.content, "返信");
  assert.deepEqual(result.failures, []);
} finally { await client.destroy(); await mock.close(); }
`,
      );
      await run(
        process.execPath,
        [
          require.resolve("typescript/bin/tsc"),
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "es2022",
          "--module",
          "nodenext",
          "--allowImportingTsExtensions",
          "testClient.ts",
        ],
        { cwd: directory, env },
      );
      await run(process.execPath, ["testClient.ts"], {
        cwd: directory,
        env: { ...env, TOKEN: "既存 main の値を送信しない" },
        timeout: 10_000,
      });
      await writeFile(
        join(directory, "testClient.ts"),
        `
import * as disMock from "dismock/client";
import { configureE2E } from "dismock/e2e";
let instance = 0;
configureE2E({
  async start({ mock }) {
    const { client, main } = await import(/* @vite-ignore */ \`./main.ts?test=\${++instance}\`) as typeof import("./main.js");
    const { failures } = await disMock.Client(client, main, { baseUrl: mock.url })(mock.botToken);
    return { failures, async close() { await client.destroy(); } };
  },
});
`,
      );
      await writeFile(
        join(directory, "vitest.config.ts"),
        `
import { defineE2EConfig } from "dismock/e2e";
export default defineE2EConfig({ setup: "./testClient.ts" });
`,
      );
      await mkdir(join(directory, "tests/custom/deep"), { recursive: true });
      const testSource = `
import { test, expect } from "dismock/e2e";
test("返信を確認", { users: "all" }, async ({ bot, actor }) => {
  const sent = await actor.sendMessage("こんにちは");
  const reply = await bot.mock.messages.waitFor({ channelId: bot.channel.id, afterId: sent.id }, message => message.author.bot);
  expect(reply.content).toBe("返信");
  expect(sent.author.id).toBe(actor.id);
});
`;
      await writeFile(join(directory, "tests/direct.test.ts"), testSource);
      await writeFile(
        join(directory, "tests/custom/deep/reply.test.ts"),
        testSource,
      );
      await run(
        process.execPath,
        [
          require.resolve("typescript/bin/tsc"),
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "es2022",
          "--module",
          "nodenext",
          "--allowImportingTsExtensions",
          "testClient.ts",
          "vitest.config.ts",
          "tests/direct.test.ts",
          "tests/custom/deep/reply.test.ts",
        ],
        { cwd: directory, env },
      );
      const execution = await run(
        process.execPath,
        [join(vitestDirectory, "vitest.mjs"), "run"],
        {
          cwd: directory,
          env: { ...env, DISCORD_MOCK_REPORT_URL: "off" },
          timeout: 25_000,
        },
      );
      assert.match(execution.stdout + execution.stderr, /Tests\s+2 passed/);
      await writeFile(
        join(directory, "verify-runner.ts"),
        `
import assert from "node:assert/strict";
import { createTestEnvironment } from "dismock/e2e";
import { LocalTestCaseRunner } from "dismock/e2e/runner";
const app = await createTestEnvironment();
const runner = new LocalTestCaseRunner(() => app.url);
try {
  const cases = await runner.list();
  assert.deepEqual(cases.map(item => item.id), ["custom/deep/reply.test.ts:0", "direct.test.ts:0"]);
  await runner.start(cases[0].id, app.users.findByName("Alice")!.id);
  const deadline = Date.now() + 15000;
  while (runner.status().runningId && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(runner.status(), { runningId: null, error: null });
} finally { await runner.close(); await app.close(); }
`,
      );
      await run(process.execPath, ["verify-runner.ts"], {
        cwd: directory,
        env,
        timeout: 20_000,
      });
      assert.deepEqual((await readdir(join(directory, "tests"))).sort(), [
        "custom",
        "direct.test.ts",
      ]);
      // 利用者の src や Vitest 設定なしに、任意名の1ファイルから起動する。
      await rm(join(directory, "vitest.config.ts"));
      await rm(join(directory, "testClient.ts"));
      let entry = join(directory, "launch local bot.ts");
      await writeFile(
        entry,
        `
import * as disMock from "dismock/client";
import { runTestClient } from "dismock/e2e";
let instance = 0;
await runTestClient(import.meta.url, {
  name: "consumer",
  async bot({ url, token }) {
    const { client, main } = await import(/* @vite-ignore */ \`./main.ts?run=\${++instance}\`) as typeof import("./main.js");
    const { failures } = await disMock.Client(client, main, { baseUrl: url })(token);
    return { failures, async close() { await client.destroy(); } };
  },
});
`,
      );
      const runtimeDir = join(directory, "runtime");
      const directEnv = {
        ...env,
        DISCORD_MOCK_PORT: "0",
        DISCORD_MOCK_DATA_DIR: runtimeDir,
        DISCORD_MOCK_ENV_FILE: join(directory, ".env"),
        TOKEN: "production-placeholder-must-not-appear",
      };
      const tsx = require.resolve("tsx/cli");
      const child = spawn(process.execPath, [tsx, entry], {
        cwd: directory,
        env: directEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      try {
        const deadline = Date.now() + 15_000;
        while (
          !output.includes("consumer connected to") &&
          Date.now() < deadline &&
          child.exitCode === null
        )
          await new Promise((resolve) => setTimeout(resolve, 25));
        assert.match(output, /consumer connected to/);
        const connection = JSON.parse(
          await readFile(join(runtimeDir, "runtime.json"), "utf8"),
        ) as { url: string };
        assert.equal(new URL(connection.url).hostname, "127.0.0.1");
        const sessionResponse = await fetch(
          new URL("/_ui/session", connection.url),
        );
        const session = (await sessionResponse.json()) as { csrf: string };
        const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
        assert.ok(cookie);
        assert.equal(
          (
            await fetch(new URL("/_ui/messages", connection.url), {
              method: "POST",
              headers: {
                cookie,
                "content-type": "application/json",
                "x-discord-mock-csrf": session.csrf,
              },
              body: JSON.stringify({
                channel_id: "123456789000000002",
                content: "通常 Bot の起動確認",
              }),
            })
          ).status,
          201,
        );
        const direct = await run(process.execPath, [tsx, entry, "--test"], {
          cwd: directory,
          env: directEnv,
          timeout: 25_000,
        });
        assert.match(direct.stdout + direct.stderr, /Tests\s+2 passed/);
        assert.doesNotMatch(output, /production-placeholder-must-not-appear/);
      } finally {
        child.kill("SIGTERM");
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 6000);
        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      }
      assert.equal(child.exitCode, 0);
      assert.equal((await readdir(runtimeDir)).includes("app.lock"), false);
      assert.equal((await readdir(runtimeDir)).includes("bot.lock"), false);
      const renamed = join(directory, "another arbitrary name.ts");
      await rename(entry, renamed);
      entry = renamed;
      const standalone = await run(process.execPath, [tsx, entry, "--test"], {
        cwd: directory,
        env: { ...directEnv, DISCORD_MOCK_REPORT_URL: "off" },
        timeout: 25_000,
      });
      assert.match(standalone.stdout + standalone.stderr, /Tests\s+2 passed/);
      assert.equal(await readFile(botFile, "utf8"), original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
