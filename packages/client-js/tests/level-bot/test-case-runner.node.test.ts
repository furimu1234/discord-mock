import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { LocalTestCaseRunner, discoverTestCases } from "dismock/e2e/runner";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sampleRoot = fileURLToPath(
  new URL("../../../../examples/level_bot/", import.meta.url),
);

test("テストケースは TypeScript の定義済みテストだけを列挙・実行対象にする", async () => {
  const runner = new LocalTestCaseRunner(() => "http://127.0.0.1:3000", {
    root: sampleRoot,
  });
  try {
    const cases = await runner.list();
    assert.ok(cases.some((item) => item.name.includes("レベル")));
    assert.ok(
      cases.every((item) => /^[a-zA-Z0-9_./-]+\.test\.ts:\d+$/.test(item.id)),
    );
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
    {
      name: "親グループ › 子グループ › 同じテスト名",
      fullName: "親グループ > 子グループ > 同じテスト名",
    },
    {
      name: "親グループ › 子グループ › 別のテスト",
      fullName: "親グループ > 子グループ > 別のテスト",
    },
    {
      name: "親グループ › もう一つ › 同じテスト名",
      fullName: "親グループ > もう一つ > 同じテスト名",
    },
    { name: "トップレベル", fullName: "トップレベル" },
  ]);
});

test("同一describe階層の重複したテスト名は個別実行の曖昧さを防ぐ", () => {
  assert.throws(
    () =>
      discoverTestCases(
        `
    describe("同一", () => {
      test("重複", () => {});
      test("重複", () => {});
    });
  `,
        "duplicate.test.ts",
      ),
    /重複した名前/,
  );
});

test("実際のレベルテストはdescribeの二段階ネストもケース一覧に載る", async () => {
  const runner = new LocalTestCaseRunner(() => "http://127.0.0.1:3000", {
    root: sampleRoot,
  });
  try {
    const cases = await runner.list();
    assert.ok(
      cases.some(
        (item) => item.name === "/レベル確認 › 直接設定 › 任意のレベルを指定",
      ),
    );
  } finally {
    await runner.close();
  }
});

test(
  "Vitest 5の階層名を指定すると実際に対象1件だけが実行され全skipにならない",
  {
    timeout: 45_000,
  },
  async () => {
    const tsx = fileURLToPath(import.meta.resolve("tsx/cli"));
    const cwd = fileURLToPath(
      new URL("../../../../examples/level_bot/", import.meta.url),
    );
    const name = "^/レベル確認 > 直接設定 > 任意のレベルを指定$";
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        tsx,
        "--tsconfig",
        "packages/bot/tsconfig.json",
        "packages/bot/src/testClient.ts",
        "--test",
        "tests/bot/showLvl.test.ts",
        "--testNamePattern",
        name,
      ],
      {
        cwd,
        env: { ...process.env, DISCORD_MOCK_REPORT_URL: "" },
        timeout: 40_000,
      },
    );
    assert.match(stdout + stderr, /1 passed/);
    assert.doesNotMatch(stdout + stderr, /Tests\s+5 skipped/);
  },
);

test("tests直下・任意階層・同名ファイルを区別し、シンボリックリンクを追跡しない", async () => {
  const root = await mkdtemp(join(tmpdir(), "dismock-discovery-"));
  try {
    await mkdir(join(root, "tests/custom/deep"), { recursive: true });
    await mkdir(join(root, "tests/other"));
    await writeFile(
      join(root, "tests/direct.v2.test.ts"),
      'test("直下", { users: "all" }, async () => {});',
    );
    await writeFile(
      join(root, "tests/custom/deep/same.test.ts"),
      'describe("親", () => { test("子", async () => {}); });',
    );
    await writeFile(
      join(root, "tests/other/same.test.ts"),
      'test("別ケース", async () => {});',
    );
    await writeFile(
      join(root, "outside.test.ts"),
      'test("外側", async () => {});',
    );
    await symlink(
      join(root, "outside.test.ts"),
      join(root, "tests/linked.test.ts"),
    );
    const runner = new LocalTestCaseRunner(() => "http://127.0.0.1:3000", {
      root,
    });
    try {
      assert.deepEqual(
        (await runner.list()).map(({ id }) => id),
        [
          "custom/deep/same.test.ts:0",
          "direct.v2.test.ts:0",
          "other/same.test.ts:0",
        ],
      );
      await assert.rejects(
        runner.start("../outside.test.ts:0"),
        /存在しません/,
      );
      assert.throws(
        () =>
          new LocalTestCaseRunner(() => "http://127.0.0.1:3000", {
            root,
            testsDir: "../",
          }),
        /プロジェクト内/,
      );
    } finally {
      await runner.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
