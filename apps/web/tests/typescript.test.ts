import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";

test("TypeScript テストからブラウザのビルド成果物を検証できる", async () => {
  const source = await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Script(source));
});
