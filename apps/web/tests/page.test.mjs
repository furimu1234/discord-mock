import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
test("Local Web test page is interactive, same-origin and authored in TypeScript", async () => {
  const source = await readFile(new URL("../src/page.ts", import.meta.url), "utf8");
  assert.match(source, /export function renderPage/);
  assert.match(source, /renderBrowserScript/);
  assert.match(source, /EventSource/);
  assert.match(source, /_ui\/messages/);
  assert.match(source, /_ui\/identity/);
  assert.match(source, /音声プロトコル/);
});
