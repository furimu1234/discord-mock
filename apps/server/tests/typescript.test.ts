import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

test("TypeScript テストからビルド済み Mock サーバーを読み込める", () => {
  const require = createRequire(import.meta.url);
  const server = require("../dist/server.cjs") as { startMock?: unknown };
  assert.equal(typeof server.startMock, "function");
});
