import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  commandsCollection,
  loadCommands,
  type CommandIssue,
} from "../../packages/bot/src/commands/main.js";

function command(name: string) {
  return `export const data = { toJSON: () => ({ name: '${name}', description: 'test' }) };
    export async function execute(): Promise<void> {}`;
}

test("TS コマンドを再帰的に検出し、失敗ファイルをスキップして後続を登録する", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "discord-mock-command-loader-"),
  );
  const issues: CommandIssue[] = [];
  const attempts: string[] = [];
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    await mkdir(join(directory, "nested"));
    for (const [name, source] of [
      ["00-syntax.ts", "export const = ;"],
      ["01-import.ts", "import './missing.ts';"],
      ["02-exports.ts", "export const data = {};"],
      [
        "03-definition.ts",
        "export const data = { toJSON() { throw new Error('DO_NOT_LOG_SOURCE'); } }; export async function execute() {}",
      ],
      ["04-register.ts", command("rejected")],
      ["05-first.ts", command("same")],
      ["06-duplicate.ts", command("same")],
      ["07-good.ts", command("good")],
      ["ignored.d.ts", "invalid declaration, never imported"],
      ["nested/日本語 コマンド #.ts", command("nested")],
    ])
      await writeFile(join(directory, name), source);
    const definitions = await loadCommands({
      directory: pathToFileURL(directory),
      onError: (issue) => issues.push(issue),
      register: async (definition) => {
        attempts.push(definition.name);
        if (definition.name === "rejected")
          throw new Error("DO_NOT_LOG_REGISTRATION");
      },
    });
    assert.deepEqual(
      definitions.map((item) => item.name),
      ["same", "good", "nested"],
    );
    assert.deepEqual(
      [...commandsCollection.keys()],
      ["same", "good", "nested"],
    );
    assert.deepEqual(attempts, ["rejected", "same", "good", "nested"]);
    assert.deepEqual(
      issues.map((issue) => issue.reason),
      ["import", "import", "exports", "definition", "register", "duplicate"],
    );
    assert.doesNotMatch(JSON.stringify(issues), /DO_NOT_LOG/);
    assert.equal(
      issues.some((issue) => issue.file.endsWith("ignored.d.ts")),
      false,
    );

    const missing: CommandIssue[] = [];
    assert.deepEqual(
      await loadCommands({
        directory: pathToFileURL(join(directory, "missing")),
        onError: (issue) => missing.push(issue),
      }),
      [],
    );
    assert.equal(missing[0].reason, "directory");
    assert.equal(
      commandsCollection.size,
      0,
      "次回読み込みへ古いハンドラーを残さない",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
