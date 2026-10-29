import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  callsRunTestClient,
  discoverTestClients,
} from "../src/client-discovery.ts";
import { BotProcess } from "../src/bot-process.ts";

const require = createRequire(
  new URL("../../../packages/client-js/package.json", import.meta.url),
);
test("SDKの実呼び出しを検出し、コメント・文字列・型・別ライブラリは除く", () => {
  for (const source of [
    'import {runTestClient} from "dismock/e2e"; await runTestClient(import.meta.url, {});',
    'import {runTestClient as launch} from "dismock/e2e"; launch(import.meta.url, {});',
    'import * as mock from "dismock/e2e"; mock.runTestClient(import.meta.url, {});',
    'const {runTestClient: launch} = require("dismock/e2e"); launch(__filename, {});',
    'const mock = require("dismock/e2e"); mock.runTestClient(__filename, {});',
    'const {runTestClient} = await import("dismock/e2e"); runTestClient(import.meta.url, {});',
  ])
    assert.equal(callsRunTestClient("arbitrary.ts", source), true, source);
  for (const source of [
    '// import {runTestClient} from "dismock/e2e"; runTestClient(import.meta.url, {});',
    'const text = `import {runTestClient} from "dismock/e2e"; runTestClient(import.meta.url, {});`;',
    'import {runTestClient} from "other"; runTestClient(import.meta.url, {});',
    'import type {runTestClient} from "dismock/e2e"; runTestClient(import.meta.url, {});',
    'import {runTestClient} from "dismock/e2e";',
  ])
    assert.equal(callsRunTestClient("arbitrary.ts", source), false, source);
});

async function directory() {
  return mkdtemp(join(tmpdir(), "dismock-discover-"));
}
const source =
  'import {runTestClient} from "dismock/e2e"; runTestClient(import.meta.url, {});';

test("直下の任意名だけを検出し、読取中にコードを実行せず、TSXとtsconfigを設定する", async () => {
  const root = await directory();
  try {
    const folder = join(root, "src");
    await mkdir(folder);
    await mkdir(join(root, "node_modules"));
    await symlink(
      dirname(require.resolve("tsx/package.json")),
      join(root, "node_modules/tsx"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(root, "tsconfig.json"), "{}");
    await writeFile(
      join(folder, "not-a-fixed-name.ts"),
      `throw new Error("must not execute"); ${source}`,
    );
    await writeFile(join(folder, "helper.js"), "// runTestClient()");
    await writeFile(join(folder, "ignored.d.ts"), source);
    await mkdir(join(folder, "nested"));
    await writeFile(join(folder, "nested/hidden.js"), source);
    if (process.platform !== "win32")
      await symlink(
        join(folder, "not-a-fixed-name.ts"),
        join(folder, "link.ts"),
      );
    const found = await discoverTestClients(folder);
    assert.equal(found.length, 1);
    assert.equal(found[0].file, "not-a-fixed-name.ts");
    assert.equal(found[0].config.command, "node");
    assert.equal(found[0].config.runtime, "test-client");
    assert.equal(found[0].config.cwd, folder);
    assert.deepEqual(found[0].config.args, [
      require.resolve("tsx/cli"),
      "--tsconfig",
      join(root, "tsconfig.json"),
      join(folder, "not-a-fixed-name.ts"),
    ]);
    await writeFile(join(folder, "another.mjs"), source);
    assert.deepEqual(
      (await discoverTestClients(folder)).map((item) => item.file),
      ["another.mjs", "not-a-fixed-name.ts"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("候補ゼロは空配列、tsx不足と大きすぎるファイルは説明付きで失敗する", async () => {
  const root = await directory();
  try {
    assert.deepEqual(await discoverTestClients(root), []);
    await writeFile(join(root, "client.ts"), source);
    for (const name of ["tsx", "dismock"]) {
      await mkdir(join(root, "node_modules", name), { recursive: true });
      await writeFile(
        join(root, "node_modules", name, "package.json"),
        JSON.stringify({ name, exports: {} }),
      );
    }
    await assert.rejects(discoverTestClients(root), /tsx が見つかりません/);
    await writeFile(join(root, "client.ts"), " ".repeat(512 * 1024 + 1));
    await assert.rejects(discoverTestClients(root), /512 KiB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("自動設定を保存して起動すると、対象ファイルが実行され、親のMock接続先を引き継がない", async () => {
  const root = await directory();
  const bot = new BotProcess(
    join(root, "config.json"),
    () => ({
      TOKEN: "mock_parent",
      DISCORD_MOCK_URL: "http://127.0.0.1:1",
      DISCORD_MOCK_STATE_PATH: join(root, "parent.json"),
    }),
    () => {},
    root,
  );
  try {
    // SDKを模したローカルモジュール。取得時のimport・評価が無いことも確認する。
    await mkdir(join(root, "node_modules/dismock"), { recursive: true });
    await writeFile(
      join(root, "node_modules/dismock/package.json"),
      JSON.stringify({
        name: "dismock",
        type: "module",
        exports: { "./e2e": "./index.mjs" },
      }),
    );
    await writeFile(
      join(root, "node_modules/dismock/index.mjs"),
      "export function runTestClient() {}",
    );
    const output = join(root, "executed.json");
    await writeFile(
      join(root, "client.mjs"),
      `${source}
      import {writeFileSync} from 'node:fs';
      writeFileSync(${JSON.stringify(output)}, JSON.stringify({token: process.env.TOKEN, url: process.env.DISCORD_MOCK_URL, state: process.env.DISCORD_MOCK_STATE_PATH, port: process.env.DISCORD_MOCK_PORT}));
      setInterval(()=>{},1000);`,
    );
    const [found] = await discoverTestClients(root);
    await assert.rejects(readFile(output), { code: "ENOENT" });
    await bot.save(found.config);
    await bot.load();
    await bot.start();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await readFile(output).then(
          () => true,
          () => false,
        )
      )
        break;
      await delay(20);
    }
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { port: "0" });
    assert.equal(bot.status().running, true);
    await bot.stop();
    assert.equal(bot.status().running, false);
  } finally {
    await bot.stop();
    await rm(root, { recursive: true, force: true });
  }
});
