import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

test("testing 配布物はソースや node_modules がない場所でも ESM から利用できる", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "discord-mock-testing-bundle-"),
  );
  try {
    await copyFile(
      new URL("../dist/testing.cjs", import.meta.url),
      join(directory, "testing.cjs"),
    );
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import { createTestEnvironment } from './testing.cjs';
      import assert from 'node:assert/strict';
      const mock = await createTestEnvironment();
      try {
        assert.equal(new URL(mock.url).hostname, '127.0.0.1');
        const user = await mock.users.create({username: '単体配布'});
        const channel = await mock.channels.create({name: 'test'});
        const message = await mock.as(user).sendMessage(channel.id, 'hello');
        assert.equal(message.author.id, user.id);
        assert.equal(mock.users.get(user.id).username, '単体配布');
      } finally { await mock.close(); }
    `,
      ],
      { cwd: directory, timeout: 10_000 },
    );
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
