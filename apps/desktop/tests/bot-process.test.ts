import assert from "node:assert/strict";
import { test } from "node:test";
import { validateConfig } from "../src/bot-process.js";

test("Bot コマンド設定は絶対作業ディレクトリと引数配列だけを受理する", () => {
  const cwd = process.platform === "win32" ? "C:\\tests" : "/tmp/tests";
  assert.deepEqual(validateConfig({ command: "node", args: ["-v"], cwd }),
    { command: "node", args: ["-v"], cwd });
  assert.throws(() => validateConfig({ command: "", args: [], cwd }));
  assert.throws(() => validateConfig({ command: "node", args: ["ok", 42], cwd }));
  assert.throws(() => validateConfig({ command: "node", args: [], cwd: "." }));
  assert.throws(() => validateConfig({ command: "node\nbad", args: [], cwd }));
});
