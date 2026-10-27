import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import pg from "pg";
import { startApp } from "../dist/app-runtime.mjs";

const botEntrypoint = fileURLToPath(new URL("../dist/bot.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const channelId = "123456789000000002";
const guildId = "123456789000000000";

function spawnBot(directory, envFile, overrides = {}) {
  const env = { ...process.env };
  for (const key of ["TOKEN", "DISCORD_MOCK_TOKEN", "DISCORD_MOCK_URL", "POST_URL"]) delete env[key];
  Object.assign(env, {
    DISCORD_MOCK_DATA_DIR: directory,
    DISCORD_MOCK_ENV_FILE: envFile,
    ...overrides,
  });
  const child = spawn(process.execPath, [botEntrypoint], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  return {
    child,
    exited,
    output: () => output,
    errors: () => errors,
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await exited;
    },
  };
}

async function until(check, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await setTimeout(50);
  }
  throw new Error(`Timed out: ${description}`);
}

test("app and .env-driven Bot run independently; Bot restart preserves DB and app restart reuses token", { timeout: 35_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-separate-"));
  const envFile = join(directory, ".env");
  let app;
  let bot;
  let pool;
  try {
    app = await startApp({ dataDir: directory, port: 0 });
    const firstToken = app.mock.token;
    await assert.rejects(startApp({ dataDir: directory, port: 0 }), /already running/);
    const envContents = `# discord用\n#TOKEN=unused\n\n# テスト用\nTOKEN=${firstToken}\n`;
    await writeFile(envFile, envContents);

    const sessionResponse = await fetch(`${app.mock.url}/_ui/session`);
    const session = await sessionResponse.json();
    const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
    const uiState = async () => (await fetch(`${app.mock.url}/_ui/state`, { headers: { cookie } })).json();
    assert.equal((await uiState()).botConnections, 0);
    pool = new pg.Pool({ connectionString: app.database.dsn, max: 1 });

    const failed = spawnBot(directory, envFile, { TOKEN: "mock_invalid_for_this_app" });
    try {
      assert.equal((await failed.exited)[0], 1);
      assert.equal((await readdir(directory)).includes("bot.lock"), false, "failed SDK login releases the Bot lock");
      assert.equal((await uiState()).botConnections, 0);
    } finally { await failed.close(); }

    for (let iteration = 0; iteration < 2; iteration++) {
      bot = spawnBot(directory, envFile);
      await until(() => {
        if (bot.child.exitCode !== null) throw new Error(`Bot startup failed: ${bot.errors()}`);
        return bot.output().includes("level_bot connected");
      }, "Bot connection");
      await until(() => bot.output().includes("BOT START"), "Ready log");
      assert.equal((await uiState()).botConnections, 1);
      const duplicate = spawnBot(directory, envFile);
      try {
        const [code] = await duplicate.exited;
        assert.equal(code, 1);
        assert.match(duplicate.errors(), /Bot is already running/);
        assert.doesNotMatch(duplicate.output(), /BOT START|level_bot connected/);
        assert.equal((await uiState()).botConnections, 1);
      } finally { await duplicate.close(); }
      assert.ok((await uiState()).commands.length > 0);
      assert.equal((await fetch(`${app.mock.url}/health`)).status, 200);

      const sent = await fetch(`${app.mock.url}/_ui/messages`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "x-discord-mock-csrf": session.csrf },
        body: JSON.stringify({ channel_id: channelId, content: `Separate process message ${iteration}` }),
      });
      assert.equal(sent.status, 201);
      await until(async () => {
        const result = await pool.query("SELECT lvl FROM example.lvl WHERE server_id=$1 AND user_id=$2", [guildId, session.selectedUserId]);
        return result.rows[0]?.lvl === iteration + 2;
      }, "leveling update through real pg");
      await bot.close();
      bot = undefined;
      await until(async () => (await uiState()).botConnections === 0, "Bot disconnect");
      assert.equal((await fetch(`${app.mock.url}/health`)).status, 200);
    }

    assert.equal(await readFile(envFile, "utf8"), envContents);
    await pool.end();
    pool = undefined;
    await app.close();
    app = undefined;
    assert.deepEqual((await readdir(directory)).sort(), [".env", "credentials.json"]);

    app = await startApp({ dataDir: directory, port: 0 });
    assert.equal(app.mock.token, firstToken);
    assert.equal(JSON.parse(await readFile(app.paths.credentials, "utf8")).token, firstToken);
  } finally {
    await bot?.close();
    await pool?.end();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Bot entrypoint rejects production tokens before loading SDK or connection settings", { timeout: 5000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-production-token-"));
  let bot;
  try {
    const envFile = join(directory, ".env");
    for (const [contents, overrides] of [
      ["TOKEN=production_token_placeholder\n", {}],
      ["TOKEN=mock_from_env_file\n", { TOKEN: "production_token_placeholder" }],
    ]) {
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
});

test("pnpm app and pnpm bot handle process-group shutdown without leaving an app lock", {
  timeout: 20_000,
  skip: process.platform === "win32", // POSIX process groups; Windows CLI is tested separately.
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-pnpm-"));
  const envFile = join(directory, ".env");
  const processes = [];
  const env = { ...process.env, DISCORD_MOCK_DATA_DIR: directory, DISCORD_MOCK_ENV_FILE: envFile, DISCORD_MOCK_PORT: "0" };
  for (const key of ["TOKEN", "DISCORD_MOCK_TOKEN", "DISCORD_MOCK_URL", "POST_URL"]) delete env[key];

  function command(name) {
    const child = spawn("pnpm", [name], { cwd: repositoryRoot, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const exited = once(child, "exit");
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.resume();
    const result = {
      child,
      output: () => output,
      async close() {
        try { process.kill(-child.pid, "SIGTERM"); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
        await exited;
      },
    };
    processes.push(result);
    return result;
  }

  try {
    await writeFile(envFile, "");
    const app = command("app");
    await until(() => app.output().includes("Run pnpm bot"), "pnpm app startup");
    const { token } = JSON.parse(await readFile(join(directory, "credentials.json"), "utf8"));
    const { url } = JSON.parse(await readFile(join(directory, "runtime.json"), "utf8"));
    await writeFile(envFile, `TOKEN=${token}\n`);
    const bot = command("bot");
    await until(() => bot.output().includes("level_bot connected"), "pnpm bot startup");
    await bot.close();
    assert.equal((await fetch(`${url}/health`)).status, 200);
    await app.close();
    await until(async () => {
      const files = await readdir(directory);
      return !files.includes("app.lock") && !files.includes("bot.lock") && !files.includes("runtime.json");
    }, "app shutdown cleanup");
  } finally {
    for (const child of processes.reverse()) await child.close();
    await rm(directory, { recursive: true, force: true });
  }
});
