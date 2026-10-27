import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("preview clearly distinguishes test and admin placeholders", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(page, /テスト画面（未実装）/);
  assert.match(page, /管理画面（未実装）/);
  assert.match(page, /Discord API \/ Gateway \/ Voice/);
});
