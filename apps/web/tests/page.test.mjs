import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
test("Web view is authored in TypeScript", async () => {
  const source = await readFile(new URL("../src/page.ts", import.meta.url), "utf8");
  assert.match(source, /export function renderPage/);
  assert.match(source, /音声プロトコル/);
});
