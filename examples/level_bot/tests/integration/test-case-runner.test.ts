import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalTestCaseRunner } from "../../src/test-case-runner.js";
import { discoverTestCases } from "../../src/test-case-discovery.js";

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

test("静的なdescribeネストを完全名で識別し、同名testを別階層として区別する", () => {
  const source = `
    // test("コメントは数えない", async () => {});
    const str = 'test("文字列も数えない", async () => {})';
    describe("親グループ", () => {
      describe("子グループ", () => {
        test("同じテスト名", { users: "login" }, async ({ actor }) => {
          await actor.sendMessage('hello');
          test("本文中の呼び出しは登録しない", () => {});
        });
        it("別のテスト", async () => {});
        test.skip("スキップされたテスト", () => {});
        test(variableName, () => {});
      });
      describe("もう一つ", function () {
        test("同じテスト名", async () => {});
      });
    });
    test("トップレベル", async () => {});
  `;
  assert.deepEqual(discoverTestCases(source, "sample.test.ts"), [
    { name: "親グループ › 子グループ › 同じテスト名", fullName: "親グループ > 子グループ > 同じテスト名" },
    { name: "親グループ › 子グループ › 別のテスト", fullName: "親グループ > 子グループ > 別のテスト" },
    { name: "親グループ › もう一つ › 同じテスト名", fullName: "親グループ > もう一つ > 同じテスト名" },
    { name: "トップレベル", fullName: "トップレベル" },
  ]);
});

test("同一describe階層の重複したテスト名は個別実行の曖昧さを防ぐ", () => {
  assert.throws(() => discoverTestCases(`
    describe("同一", () => {
      test("重複", () => {});
      test("重複", () => {});
    });
  `, "duplicate.test.ts"), /重複した名前/);
});

test("実際のレベルテストはdescribeの二段階ネストもケース一覧に載る", async () => {
  const runner = new LocalTestCaseRunner(() => "http://127.0.0.1:3000");
  try {
    const cases = await runner.list();
    assert.ok(cases.some((item) =>
      item.name === "/レベル確認 › 直接設定 › 任意のレベルを直接設定し、通常の投稿でさらにレベルアップできる"));
  } finally { await runner.close(); }
});
