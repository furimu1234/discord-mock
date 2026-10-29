import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BotProcess } from "../src/bot-process.ts";

async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error("接続通知が届きませんでした");
}
test("同時起動を1つにまとめ、認証済みの接続だけを採用し、停止で解除する", async () => {
  const root = await mkdtemp(join(tmpdir(), "dismock-runtime-link-"));
  const cookie = "a".repeat(48);
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        authenticated:
          request.headers.cookie === `discord_mock_admin=${cookie}`,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const notifications: Array<{ url: string } | null> = [];
  const bot = new BotProcess(
    join(root, "config.json"),
    () => ({}),
    () => {},
    root,
    (connection) => {
      notifications.push(connection);
    },
  );
  try {
    const entry = join(root, "client.mjs");
    await writeFile(
      entry,
      `import {writeFileSync, renameSync, appendFileSync} from 'node:fs';
      const file = process.env.DISMOCK_DESKTOP_CONNECTION_FILE;
      writeFileSync(file+'.tmp', JSON.stringify({schemaVersion:1,nonce:process.env.DISMOCK_DESKTOP_CONNECTION_NONCE,url:${JSON.stringify(url)},adminSession:${JSON.stringify(cookie)}}), {mode:0o600});
      renameSync(file+'.tmp',file);
      appendFileSync(${JSON.stringify(join(root, "starts"))},process.pid+'\\n');
      console.log('\\x1b[32mready\\x1b[0m');
      setInterval(()=>{},1000);`,
    );
    await bot.save({
      command: "node",
      args: [entry],
      cwd: root,
      runtime: "test-client",
    });
    const statuses = await Promise.all([bot.start(), bot.start()]);
    assert.equal(statuses[0].pid, statuses[1].pid);
    await until(() => notifications.length === 1);
    assert.equal(bot.status().url, url);
    assert.equal(bot.status().connecting, false);
    assert.equal(
      (await readFile(join(root, "starts"), "utf8")).trim().split("\n").length,
      1,
    );
    assert.equal(JSON.stringify(bot.status()).includes(cookie), false);
    assert.equal(JSON.stringify(bot.logs()).includes(cookie), false);
    assert.equal(
      bot.logs().some((entry) => entry.text.includes("\u001b")),
      false,
    );
    await until(
      async () =>
        !(await readdir(root)).some((name) => name.startsWith("connection-")),
    );
    await bot.stop();
    assert.equal(notifications.at(-1), null);
    assert.equal(bot.status().running, false);
  } finally {
    await bot.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("別nonce・外部接続先・不正Cookieの通知を画面へ渡さない", async () => {
  const root = await mkdtemp(join(tmpdir(), "dismock-invalid-link-"));
  const changes: unknown[] = [];
  const bot = new BotProcess(
    join(root, "config.json"),
    () => ({}),
    () => {},
    root,
    (value) => {
      changes.push(value);
    },
  );
  try {
    const entry = join(root, "client.mjs");
    await writeFile(
      entry,
      `import {writeFileSync} from 'node:fs';
      writeFileSync(process.env.DISMOCK_DESKTOP_CONNECTION_FILE, JSON.stringify({schemaVersion:1,nonce:'wrong',url:'https://example.invalid',adminSession:'private_invalid_cookie'}));
      setInterval(()=>{},1000);`,
    );
    await bot.save({
      command: "node",
      args: [entry],
      cwd: root,
      runtime: "test-client",
    });
    await bot.start();
    await until(() => bot.logs().some((entry) => entry.stream === "stderr"));
    assert.equal(changes.length, 0);
    assert.equal(bot.status().url, undefined);
    assert.equal(
      JSON.stringify(bot.logs()).includes("private_invalid_cookie"),
      false,
    );
  } finally {
    await bot.stop();
    await rm(root, { recursive: true, force: true });
  }
});
