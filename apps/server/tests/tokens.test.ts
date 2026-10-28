import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs");

test("token JSON generates once, survives restart and authenticates REST", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-token-"));
  const tokenPath = join(directory, "credentials.json");
  let mock;
  try {
    mock = await startMock({ port: 0, tokenPath });
    const firstToken = mock.token;
    assert.match(firstToken, /^mock_[a-f0-9]+$/);
    assert.deepEqual(JSON.parse(await readFile(tokenPath, "utf8")), { schemaVersion: 1, token: firstToken });
    if (process.platform !== "win32") assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
    await mock.close();
    mock = undefined;

    mock = await startMock({ port: 0, tokenPath });
    assert.equal(mock.token, firstToken);
    const response = await fetch(`${mock.url}/api/v10/users/@me`, {
      headers: { authorization: `Bot ${firstToken}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).bot, true);
    const stateResponse = await fetch(`${mock.url}/_mock/state`, {
      headers: { "x-discord-mock-secret": mock.adminSecret },
    });
    assert.doesNotMatch(await stateResponse.text(), new RegExp(firstToken));
    assert.deepEqual(await readdir(directory), ["credentials.json"]);
  } finally {
    await mock?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an existing JSON without a token receives one; invalid files are preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-token-invalid-"));
  const tokenPath = join(directory, "credentials.json");
  try {
    await writeFile(tokenPath, '{"schemaVersion":1}');
    const mock = await startMock({ port: 0, tokenPath });
    await mock.close();
    assert.match(JSON.parse(await readFile(tokenPath, "utf8")).token, /^mock_/);

    for (const content of ["{broken", "null", '{"token":"production_token"}', '{"schemaVersion":2}']) {
      await writeFile(tokenPath, content);
      await assert.rejects(startMock({ port: 0, tokenPath }));
      assert.equal(await readFile(tokenPath, "utf8"), content);
      assert.deepEqual(await readdir(directory), ["credentials.json"]);
    }

    await writeFile(`${tokenPath}.lock`, "busy");
    await assert.rejects(startMock({ port: 0, tokenPath }), /in use/);
    assert.equal(await readFile(tokenPath, "utf8"), '{"schemaVersion":2}');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
