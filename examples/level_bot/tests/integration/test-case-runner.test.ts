import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalTestCaseRunner } from "../../src/test-case-runner.js";

test("テストケースは TypeScript の定義済みテストだけを列挙・実行対象にする", async () => {
  const runner = new LocalTestCaseRunner(() => "http://127.0.0.1:3000");
  try {
    const cases = await runner.list();
    assert.ok(cases.some((item) => item.name.includes("レベル")));
    assert.ok(cases.every((item) => /^[a-zA-Z0-9_-]+\.test\.ts:\d+$/.test(item.id)));
    await assert.rejects(runner.start("../../../package.json"), /存在しません/);
    assert.equal(runner.status().runningId, null);
  } finally {
    await runner.close();
  }
});
