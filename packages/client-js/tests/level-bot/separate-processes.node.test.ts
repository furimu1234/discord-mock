import { required } from "./required.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import pg from "pg";
import { startApp } from "./built-app.js";
import type {
  BrowserState,
  SessionResponse,
} from "../../../../apps/web/src/types.js";

const botEntrypoint = fileURLToPath(
  new URL(
    "../../../../examples/level_bot/packages/bot/src/testClient.ts",
    import.meta.url,
  ),
);
const botTsconfig = fileURLToPath(
  new URL(
    "../../../../examples/level_bot/packages/bot/tsconfig.json",
    import.meta.url,
  ),
);
const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const channelId = "123456789000000002";
const guildId = "123456789000000000";

interface ProcessHandle {
  child: ChildProcess;
  exited: Promise<unknown[]>;
  output(): string;
  errors(): string;
  close(signal?: NodeJS.Signals): Promise<void>;
}

function spawnBot(
  directory: string,
  envFile: string,
  overrides: NodeJS.ProcessEnv = {},
  runtime: { tsconfig?: string; entrypoint?: string } = {},
): ProcessHandle {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "TOKEN",
    "DISCORD_MOCK_TOKEN",
    "DISCORD_MOCK_URL",
    "POST_URL",
  ])
    delete env[key];
  Object.assign(env, {
    DISCORD_MOCK_DATA_DIR: directory,
    DISCORD_MOCK_ENV_FILE: envFile,
    ...overrides,
  });
  const child = spawn(
    process.execPath,
    [
      tsxCli,
      "--tsconfig",
      runtime.tsconfig ?? botTsconfig,
      runtime.entrypoint ?? botEntrypoint,
      "--bot",
    ],
    {
      cwd: directory,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.ok(child.pid);
  const pid = child.pid;
  const exited = once(child, "exit");
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk.toString();
  });
  return {
    child,
    exited,
    output: () => output,
    errors: () => errors,
    async close() {
      const signal = (name: NodeJS.Signals) => {
        try {
          if (process.platform === "win32") child.kill(name);
          else process.kill(-pid, name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      };
      if (child.exitCode === null && child.signalCode === null)
        signal("SIGTERM");
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
      const finished = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = globalThis.setTimeout(() => resolve(false), 5000);
        }),
      ]);
      clearTimeout(timer);
      if (!finished) signal("SIGKILL");
      await exited;
    },
  };
}

async function until(
  check: () => unknown | Promise<unknown>,
  description: string,
) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await setTimeout(50);
  }
  throw new Error(`Timed out: ${description}`);
}

test(
  "app and .env-driven Bot run independently; Bot restart preserves DB and app restart reuses token",
  { timeout: 35_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mock-separate-"));
    const envFile = join(directory, ".env");
    let app: Awaited<ReturnType<typeof startApp>> | undefined;
    let bot: ProcessHandle | undefined;
    let pool: pg.Pool | undefined;
    try {
      app = await startApp({ dataDir: directory, port: 0 });
      const firstToken = app.mock.token;
      await assert.rejects(
        startApp({ dataDir: directory, port: 0 }),
        /already running/,
      );
      const envContents = `# discord用\n#TOKEN=unused\n\n# テスト用\nTOKEN=${firstToken}\n`;
      await writeFile(envFile, envContents);

      const sessionResponse = await fetch(`${app.mock.url}/_ui/session`);
      const session = (await sessionResponse.json()) as SessionResponse;
      const cookie = required(sessionResponse.headers.get("set-cookie")).split(
        ";",
      )[0];
      const baseUrl = app.mock.url;
      const uiState = async () =>
        (
          await fetch(`${baseUrl}/_ui/state`, { headers: { cookie } })
        ).json() as Promise<BrowserState>;
      assert.equal((await uiState()).botConnections, 0);
      pool = new pg.Pool({ connectionString: app.database.dsn, max: 1 });

      const failed = spawnBot(directory, envFile, {
        TOKEN: "mock_invalid_for_this_app",
      });
      try {
        assert.equal((await failed.exited)[0], 1);
        assert.equal(
          (await readdir(directory)).includes("bot.lock"),
          false,
          "failed SDK login releases the Bot lock",
        );
        assert.equal((await uiState()).botConnections, 0);
      } finally {
        await failed.close();
      }

      for (let iteration = 0; iteration < 2; iteration++) {
        bot = spawnBot(directory, envFile);
        const activeBot = bot;
        await until(() => {
          if (activeBot.child.exitCode !== null)
            throw new Error(`Bot startup failed: ${activeBot.errors()}`);
          return activeBot.output().includes("level_bot connected");
        }, "Bot connection");
        await until(
          () => activeBot.output().includes("BOT START"),
          "Ready log",
        );
        assert.equal((await uiState()).botConnections, 1);
        const duplicate = spawnBot(directory, envFile);
        try {
          const [code] = await duplicate.exited;
          assert.equal(code, 1);
          assert.match(duplicate.errors(), /Bot is already running/);
          assert.doesNotMatch(
            duplicate.output(),
            /BOT START|level_bot connected/,
          );
          assert.equal((await uiState()).botConnections, 1);
        } finally {
          await duplicate.close();
        }
        assert.ok((await uiState()).commands.length > 0);
        assert.equal((await fetch(`${app.mock.url}/health`)).status, 200);

        const sent: Response = await fetch(`${app.mock.url}/_ui/messages`, {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            "x-discord-mock-csrf": session.csrf,
          },
          body: JSON.stringify({
            channel_id: channelId,
            content: `Separate process message ${iteration}`,
          }),
        });
        assert.equal(sent.status, 201);
        await until(async () => {
          const result = await required(pool).query(
            "SELECT lvl FROM example.lvl WHERE server_id=$1 AND user_id=$2",
            [guildId, session.selectedUserId],
          );
          return result.rows[0]?.lvl === iteration + 2;
        }, "leveling update through real pg");
        await bot.close();
        bot = undefined;
        await until(
          async () => (await uiState()).botConnections === 0,
          "Bot disconnect",
        );
        assert.equal((await fetch(`${app.mock.url}/health`)).status, 200);
      }

      assert.equal(await readFile(envFile, "utf8"), envContents);
      await pool.end();
      pool = undefined;
      await app.close();
      app = undefined;
      assert.deepEqual((await readdir(directory)).sort(), [
        ".env",
        "credentials.json",
      ]);

      app = await startApp({ dataDir: directory, port: 0 });
      assert.equal(app.mock.token, firstToken);
      assert.equal(
        JSON.parse(await readFile(app.paths.credentials, "utf8")).token,
        firstToken,
      );
    } finally {
      await bot?.close();
      await pool?.end();
      await app?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "Bot entrypoint rejects production tokens before loading SDK or connection settings",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "discord-mock-production-token-"),
    );
    let bot: ProcessHandle | undefined;
    try {
      const envFile = join(directory, ".env");
      for (const [contents, overrides] of [
        ["TOKEN=production_token_placeholder\n", {}],
        [
          "TOKEN=mock_from_env_file\n",
          { TOKEN: "production_token_placeholder" },
        ],
      ] as [string, NodeJS.ProcessEnv][]) {
        await writeFile(envFile, contents);
        bot = spawnBot(directory, envFile, overrides);
        const [code] = await bot.exited;
        assert.equal(code, 1);
        assert.match(bot.errors(), /synthetic mock_/);
        assert.doesNotMatch(bot.errors(), /production_token_placeholder/);
        assert.equal(bot.output(), "");
      }
    } finally {
      await bot?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "app を Ctrl+C で先に停止しても Bot が正常終了し、再起動できる",
  {
    timeout: 30_000,
    skip: process.platform === "win32", // POSIX process groups; Windows CLI is tested separately.
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mock-pnpm-"));
    const envFile = join(directory, ".env");
    const processes: ProcessHandle[] = [];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DISCORD_MOCK_DATA_DIR: directory,
      DISCORD_MOCK_ENV_FILE: envFile,
      DISCORD_MOCK_PORT: "0",
      DISCORD_MOCK_AUTOSTART_BOT: "off",
    };
    for (const key of [
      "TOKEN",
      "DISCORD_MOCK_TOKEN",
      "DISCORD_MOCK_URL",
      "POST_URL",
    ])
      delete env[key];

    function command(name: string): ProcessHandle {
      const child = spawn("pnpm", [name], {
        cwd: repositoryRoot,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.ok(child.pid);
      const pid = child.pid;
      const exited = once(child, "exit");
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk.toString();
      });
      const result = {
        child,
        exited,
        output: () => output,
        errors: () => errors,
        async close(signal: NodeJS.Signals = "SIGTERM") {
          if (child.exitCode === null && child.signalCode === null) {
            try {
              process.kill(-pid, signal);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                throw error;
            }
          }
          await exited;
        },
      };
      processes.push(result);
      return result;
    }

    try {
      await writeFile(envFile, "");
      const app = command("app");
      await until(
        () => app.output().includes("テスト実行:"),
        "pnpm app startup",
      );
      const { token } = JSON.parse(
        await readFile(join(directory, "credentials.json"), "utf8"),
      );
      const { url } = JSON.parse(
        await readFile(join(directory, "runtime.json"), "utf8"),
      );
      await writeFile(envFile, `TOKEN=${token}\n`);
      const bot = command("bot:client");
      await until(
        () => bot.output().includes("level_bot connected"),
        "pnpm bot startup",
      ).catch((error) => {
        throw new Error(
          `${error.message}\n${(bot.output() + bot.errors()).replace(/mock_[A-Za-z0-9_-]+/g, "[REDACTED]")}`,
        );
      });
      const sessionResponse = await fetch(`${url}/_ui/session`);
      const session = (await sessionResponse.json()) as SessionResponse;
      const sent: Response = await fetch(`${url}/_ui/messages`, {
        method: "POST",
        headers: {
          cookie: required(sessionResponse.headers.get("set-cookie")).split(
            ";",
          )[0],
          "content-type": "application/json",
          "x-discord-mock-csrf": session.csrf,
        },
        body: JSON.stringify({
          channel_id: channelId,
          content: "停止前に DB 接続を使う",
        }),
      });
      assert.equal(sent.status, 201);
      const dbSession = await fetch(`${url}/_admin/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-mock-local": "1",
        },
        body: "{}",
      });
      const adminCookie = required(dbSession.headers.get("set-cookie")).split(
        ";",
      )[0];
      await until(async () => {
        const response = await fetch(
          `${url}/_admin/database/rows?schema=example&table=lvl`,
          { headers: { cookie: adminCookie } },
        );
        return (await response.json()).totalRows === 1;
      }, "Bot の DB クエリ完了後に idle 接続を切断する");
      await app.close("SIGINT");
      await until(
        () => required(bot).child.exitCode !== null,
        "app 停止後の Bot 自動終了",
      ).catch((error) => {
        throw new Error(
          `${error.message}\n${(required(bot).output() + required(bot).errors()).replace(/mock_[A-Za-z0-9_-]+/g, "[REDACTED]")}`,
        );
      });
      assert.equal((await bot.exited)[0], 0, bot.errors());
      assert.match(bot.output(), /app との接続が切れたため Bot を終了/);
      assert.doesNotMatch(
        bot.output() + bot.errors(),
        /Unhandled|secretKey|connectionParameters/,
      );
      assert.equal((bot.output() + bot.errors()).includes(token), false);
      await until(async () => {
        const files = await readdir(directory);
        return (
          !files.includes("app.lock") &&
          !files.includes("bot.lock") &&
          !files.includes("runtime.json")
        );
      }, "app shutdown cleanup");
      const restartedApp = command("app");
      await until(
        () => restartedApp.output().includes("テスト実行:"),
        "app の再起動",
      );
      const restartedBot = command("bot:client");
      await until(
        () => restartedBot.output().includes("level_bot connected"),
        "ロックを手で消さずに Bot を再起動",
      );
      await restartedBot.close();
      await restartedApp.close();
    } finally {
      for (const child of processes.reverse()) await child.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "DB をまだ使用していない Bot も app の停止で終了し、ロックを解放する",
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "discord-mock-app-monitor-"),
    );
    const envFile = join(directory, ".env");
    let app: Awaited<ReturnType<typeof startApp>> | undefined;
    let bot: ProcessHandle | undefined;
    try {
      app = await startApp({ dataDir: directory, port: 0 });
      await writeFile(envFile, `TOKEN=${app.mock.token}\n`);
      bot = spawnBot(directory, envFile);
      await until(
        () => required(bot).output().includes("level_bot connected"),
        "DB 未使用の Bot 起動",
      );
      await app.close();
      app = undefined;
      await until(
        () => required(bot).child.exitCode !== null,
        "HTTP による app 停止検知",
      ).catch((error) => {
        throw new Error(
          `${error.message}\n${(required(bot).output() + required(bot).errors()).replace(/mock_[A-Za-z0-9_-]+/g, "[REDACTED]")}`,
        );
      });
      assert.equal((await bot.exited)[0], 0, bot.errors());
      assert.equal((await readdir(directory)).includes("bot.lock"), false);
      assert.match(bot.output(), /app との接続が切れたため Bot を終了/);
      assert.doesNotMatch(
        bot.errors(),
        /Unhandled|secretKey|connectionParameters/,
      );
    } finally {
      await bot?.close();
      await app?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

async function copySourceWorkspace(workspace: string) {
  await mkdir(workspace, { recursive: true });
  await cp(
    join(repositoryRoot, "tsconfig.base.json"),
    join(workspace, "tsconfig.base.json"),
  );
  for (const relative of [
    "examples/level_bot",
    "examples/level_bot/packages/bot",
    "examples/level_bot/packages/db",
    "packages/client-js",
  ]) {
    const destination = join(workspace, relative);
    await mkdir(destination, { recursive: true });
    if (relative !== "examples/level_bot") {
      await cp(
        join(repositoryRoot, relative, "src"),
        join(destination, "src"),
        { recursive: true },
      );
    }
    await cp(
      join(repositoryRoot, relative, "package.json"),
      join(destination, "package.json"),
    );
    if (relative.endsWith("/bot")) {
      await cp(
        join(repositoryRoot, relative, "tsconfig.json"),
        join(destination, "tsconfig.json"),
      );
    }
    await symlink(
      join(repositoryRoot, relative, "node_modules"),
      join(destination, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(readdir(join(destination, "dist")), {
      code: "ENOENT",
    });
  }
  // dist への誤ったフォールバックでは解決できない値で、依存先もソースを読むことを確認する。
  for (const [relative, marker] of [
    ["examples/level_bot/packages/db", "dbSourceMarker"],
    ["packages/client-js", "clientSourceMarker"],
  ]) {
    const path = join(workspace, relative, "src/index.ts");
    await writeFile(
      path,
      `${await readFile(path, "utf8")}\nexport const ${marker} = '${marker}';\n`,
    );
  }
}

test(
  "Bot・依存先の dist なしで TS を実行し、新規・変更・削除とファイル単位の登録エラーを反映する",
  { timeout: 35000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mock-source-bot-"));
    const dataDir = join(directory, "data");
    const envFile = join(directory, ".env");
    const workspace = join(directory, "workspace");
    let app: Awaited<ReturnType<typeof startApp>> | undefined;
    let bot: ProcessHandle | undefined;
    try {
      await copySourceWorkspace(workspace);
      app = await startApp({ dataDir, port: 0 });
      await writeFile(envFile, `TOKEN=${app.mock.token}\n`);
      const commandDirectory = join(
        workspace,
        "examples/level_bot/packages/bot/src/commands",
      );
      await writeFile(
        join(commandDirectory, "00-broken.ts"),
        "export const = ;",
      );
      await writeFile(
        join(commandDirectory, "01-throw.ts"),
        "throw new Error(process.env.TOKEN);",
      );
      await writeFile(
        join(commandDirectory, "02-unsupported.ts"),
        `
      export const data = { toJSON: () => ({ name: 'unsupported', description: 'test', options: [{ type: 3, name: 'text', description: 'test' }] }) };
      export async function execute() {}
    `,
      );
      const runtime = {
        entrypoint: join(
          workspace,
          "examples/level_bot/packages/bot/src/testClient.ts",
        ),
        tsconfig: join(
          workspace,
          "examples/level_bot/packages/bot/tsconfig.json",
        ),
      };
      const sessionResponse = await fetch(`${app.mock.url}/_ui/session`);
      const session = (await sessionResponse.json()) as SessionResponse;
      const headers = {
        cookie: required(sessionResponse.headers.get("set-cookie")).split(
          ";",
        )[0],
        "x-discord-mock-csrf": session.csrf,
        "content-type": "application/json",
      };
      const baseUrl = app.mock.url;
      const state = async () =>
        (
          await fetch(`${baseUrl}/_ui/state`, { headers })
        ).json() as Promise<BrowserState>;
      let commandId: string | undefined;
      for (const version of [1, 2, null]) {
        const freshFile = join(commandDirectory, "fresh.ts");
        if (version === null) await rm(freshFile);
        else
          await writeFile(
            freshFile,
            `
        import { dbSourceMarker } from '@ex/db';
        import { clientSourceMarker } from 'dismock/client';
        const message: string = 'source-v${version}:' + dbSourceMarker + ':' + clientSourceMarker;
        export const data = { toJSON: () => ({ name: 'fresh', description: 'test' }) };
        export async function execute(interaction: { reply(text: string): Promise<void> }) { await interaction.reply(message); }
      `,
          );
        bot = spawnBot(dataDir, envFile, {}, runtime);
        const activeBot = bot;
        await until(() => {
          if (activeBot.child.exitCode !== null)
            throw new Error(`ソース実行が失敗しました: ${activeBot.errors()}`);
          return activeBot.output().includes("level_bot connected");
        }, "TS ソースからの Bot 起動");
        const view = await state();
        assert.equal(
          view.commands.some((command) => command.name === "unsupported"),
          false,
        );
        const command = view.commands.find(
          (command) => command.name === "fresh",
        );
        if (version === null) {
          assert.equal(command, undefined, "削除したファイルの古い登録も消す");
        } else {
          assert.ok(command);
          if (commandId)
            assert.equal(
              command.id,
              commandId,
              "変更後も同名コマンドの ID を保つ",
            );
          commandId = command.id;
          const invoked: Response = await fetch(
            `${app.mock.url}/_ui/interaction`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                channel_id: channelId,
                command_id: command.id,
              }),
            },
          );
          assert.equal(invoked.status, 201);
          await until(
            async () =>
              (await state()).messages[channelId].some(
                (message) =>
                  message.content ===
                  `source-v${version}:dbSourceMarker:clientSourceMarker`,
              ),
            "未ビルドのコマンドと依存 TS の変更反映",
          );
        }
        await bot.close();
        assert.match(bot.output(), /00-broken\.ts/);
        assert.match(bot.output(), /02-unsupported\.ts/);
        assert.equal(
          (bot.output() + bot.errors()).includes(app.mock.token),
          false,
          "スキップした例外からトークンをログへ漏らさない",
        );
        bot = undefined;
      }
    } finally {
      await bot?.close();
      await app?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
