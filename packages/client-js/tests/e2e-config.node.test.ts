import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createSharedDatabaseSetup,
  createTestEnvironment,
  defineE2EConfig,
} from "dismock/e2e";

function restoreReport(value: string | undefined) {
  if (value === undefined)
    Reflect.deleteProperty(process.env, "DISCORD_MOCK_REPORT_URL");
  else process.env.DISCORD_MOCK_REPORT_URL = value;
}

test("外部 origin・資格情報入りURL・壊れたruntimeを拒否し、入力値をエラーへ含めない", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dismock-runtime-"));
  const previous = process.env.DISCORD_MOCK_REPORT_URL;
  const runtimeFile = join(directory, "runtime.json");
  const secret = "dummy_private_value";
  try {
    for (const origin of [
      "https://discord.com",
      `http://user:${secret}@127.0.0.1:3000`,
      secret,
    ]) {
      process.env.DISCORD_MOCK_REPORT_URL = origin;
      await assert.rejects(
        defineE2EConfig({ root: directory, setup: "./testClient.ts" }),
        (error) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, new RegExp(secret));
          return true;
        },
      );
    }
    process.env.DISCORD_MOCK_REPORT_URL = "";
    for (const postgresDsn of [
      secret,
      `postgresql://postgres:${secret}@example.com/db`,
      `postgresql://postgres:${secret}@127.0.0.1/db?host=example.com`,
    ]) {
      const source = JSON.stringify({
        schemaVersion: 1,
        url: "http://127.0.0.1:3000",
        postgresDsn,
      });
      await writeFile(runtimeFile, source);
      await assert.rejects(
        defineE2EConfig({
          root: directory,
          runtimeFile,
          setup: "./testClient.ts",
        }),
        (error) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, new RegExp(secret));
          return true;
        },
      );
      assert.equal(await readFile(runtimeFile, "utf8"), source);
    }
    await writeFile(runtimeFile, "{broken");
    await assert.rejects(
      defineE2EConfig({
        root: directory,
        runtimeFile,
        setup: "./testClient.ts",
      }),
      /接続設定/,
    );
    assert.equal(await readFile(runtimeFile, "utf8"), "{broken");
  } finally {
    restoreReport(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Appの接続設定を検証し、共有 DB を実行全体の終了時だけ閉じる", async () => {
  const previous = process.env.DISCORD_MOCK_REPORT_URL;
  const directory = await mkdtemp(join(tmpdir(), "dismock-shared-db-"));
  const app = await createTestEnvironment();
  let started = 0;
  let closed = 0;
  const values: string[] = [];
  const setup = createSharedDatabaseSetup(async () => {
    started++;
    return {
      dsn: "postgresql://postgres@127.0.0.1:1234/db",
      async close() {
        closed++;
      },
    };
  });
  try {
    process.env.DISCORD_MOCK_REPORT_URL = "";
    const teardown = await setup({
      provide: (_name, dsn) => {
        values.push(dsn);
      },
    });
    assert.equal(started, 1);
    assert.equal(closed, 0);
    assert.ok(teardown);
    await teardown();
    assert.equal(closed, 1);
    await writeFile(
      join(directory, "runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        url: app.url,
        postgresDsn: "postgresql://postgres@127.0.0.1:1234/db",
      }),
    );
    const config = await defineE2EConfig({
      root: directory,
      runtimeFile: "./runtime.json",
      setup: "./testClient.ts",
      requireWeb: true,
    });
    assert.equal(config.test?.env?.DISCORD_MOCK_REPORT_URL, app.url);
    process.env.DISCORD_MOCK_REPORT_URL = app.url;
    assert.equal(
      await setup({
        provide: (_name, dsn) => {
          values.push(dsn);
        },
      }),
      undefined,
    );
    assert.equal(started, 1);
    assert.equal(closed, 1);
    assert.deepEqual(values, ["postgresql://postgres@127.0.0.1:1234/db", ""]);
  } finally {
    restoreReport(previous);
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
