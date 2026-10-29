import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { HostWindowStack } from "../src/wsl-window-stack.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }, mode = "normal") {
  const folder = await mkdtemp(join(tmpdir(), "dismock-host-stack-"));
  const file = join(folder, "requests.jsonl");
  const host = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/window-stack-host.ts", import.meta.url)), file, mode], { stdio: ["pipe", "pipe", "pipe"] });
  const stack = new HostWindowStack(host, "NixOS", [["Mock Admin", "Mock Chat"]]);
  t.after(async () => { await stack.close(); await rm(folder, { recursive: true, force: true }); });
  const requests = async () => (await readFile(file, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { activeTitles: string[]; peerTitles: string[]; distro: string });
  return { stack, requests };
}

test("ホスト起動待ちの古い選択を破棄し、最後に選んだ画面だけを渡す", async t => {
  const { stack, requests } = await fixture(t, "delayed");
  const first = stack.raise("Mock", "Terminal");
  const last = stack.raise("Terminal", "Mock");
  await Promise.all([first, last]);
  assert.deepEqual((await requests()).map(({ activeTitles, peerTitles, distro }) => ({ activeTitles, peerTitles, distro })), [
    { activeTitles: ["Terminal"], peerTitles: ["Mock"], distro: "NixOS" },
  ]);
});

test("タイトルをコードへ埋め込まずJSONのデータとして送る", async t => {
  const { stack, requests } = await fixture(t);
  const title = "Mock ' $() 日本語";
  await stack.raise(title, "Terminal");
  assert.deepEqual((await requests())[0].activeTitles, [title]);
  await assert.rejects(stack.raise("bad\nline", "Terminal"), /タイトル/);
  await assert.rejects(stack.raise("Mock", "Mock"), /タイトル/);
});

test("起動待ち中に管理画面とチャットのタイトルが変わっても同じ画面を識別する", async t => {
  const { stack, requests } = await fixture(t, "delayed");
  await stack.raise("Mock Admin", "Terminal");
  assert.deepEqual((await requests())[0].activeTitles, ["Mock Admin", "Mock Chat"]);
});

test("別アプリへの切り替えでホストがスキップしてもエラーにしない", async t => {
  const { stack } = await fixture(t, "skipped");
  await stack.raise("Mock", "Terminal");
});

test("ホストのエラー応答を呼び出し元へ返す", async t => {
  const { stack } = await fixture(t, "error");
  await assert.rejects(stack.raise("Mock", "Terminal"), /ウィンドウ/);
});

test("ホストが途中終了しても要求が待ち続けない", async t => {
  const { stack } = await fixture(t, "exit");
  await assert.rejects(stack.raise("Mock", "Terminal"), /終了/);
});

test("起動待ちでも終了でき、その後はウィンドウ操作を送らない", async t => {
  const { stack } = await fixture(t, "delayed");
  const pending = stack.raise("Mock", "Terminal");
  await stack.close();
  await pending;
  await stack.raise("Terminal", "Mock");
  await stack.close();
});
