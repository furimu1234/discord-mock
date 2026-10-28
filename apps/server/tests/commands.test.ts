import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs");
const appId = "123456789000000001";
const guildId = "123456789000000000";

test("command registration validates atomically, isolates scopes, persists and updates the browser list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-commands-"));
  const statePath = join(directory, "state.json");
  let mock: Awaited<ReturnType<typeof import("../src/server.js").startMock>> | undefined;
  try {
    mock = await startMock({ port: 0, statePath });
    const path = `/api/v10/applications/${appId}/commands`;
    const headers = { authorization: `Bot ${mock.token}`, "content-type": "application/json" };
    const call = (suffix: string, method = "GET", data: unknown = undefined) => fetch(mock.url + suffix, {
      method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    assert.equal((await fetch(mock.url + path)).status, 401);
    assert.equal((await call("/api/v10/applications/111111111111111111/commands")).status, 404);
    const created = await call(path, "POST", { name: "ping", description: "Global ping" });
    assert.equal(created.status, 201);
    const command = await created.json();
    assert.equal(command.application_id, appId);
    assert.equal(command.type, 1);
    assert.match(command.id, /^\d{17,20}$/);

    const updated = await call(path, "POST", { name: "ping", description: "Updated ping" });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).id, command.id);
    for (const invalid of [
      {}, [{ name: "ping", description: "valid" }, { name: "Invalid Name", description: "invalid" }],
      [{ name: "same", description: "one" }, { name: "same", description: "two" }],
      [{ name: "options", description: "unsupported", options: [{ type: 3, name: "value", description: "value" }] }],
      [{ name: "private", description: "restricted", default_member_permissions: "8" }],
    ]) {
      const response = await call(path, "PUT", invalid);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 50035);
      assert.equal((await (await call(path)).json()).length, 1);
    }
    const guildPath = `/api/v10/applications/${appId}/guilds/${guildId}/commands`;
    const overwrite = await call(guildPath, "PUT", [{ name: "ping", description: "Guild override" }]);
    assert.equal(overwrite.status, 200);
    const [guildCommand] = await overwrite.json();
    assert.equal(guildCommand.guild_id, guildId);
    assert.notEqual(guildCommand.id, command.id);
    const session = await fetch(`${mock.url}/_ui/session`);
    const cookie = session.headers.get("set-cookie").split(";")[0];
    const view = await (await fetch(`${mock.url}/_ui/state`, { headers: { cookie } })).json();
    assert.deepEqual(view.commands.map((item) => item.id), [guildCommand.id]);
    const denied = await fetch(mock.url + guildPath, { headers: { cookie } });
    assert.equal(denied.status, 401);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).commands.length, 2);

    await mock.close();
    mock = undefined;
    const validState = await readFile(statePath, "utf8");
    const invalidState = JSON.parse(validState);
    invalidState.commands[1].id = invalidState.commands[0].id;
    const invalidContents = JSON.stringify(invalidState);
    await writeFile(statePath, invalidContents);
    await assert.rejects(startMock({ port: 0, statePath }), /Duplicate saved command/);
    assert.equal(await readFile(statePath, "utf8"), invalidContents);
    await writeFile(statePath, validState);
    mock = await startMock({ port: 0, statePath });
    headers.authorization = `Bot ${mock.token}`;
    const restored = await (await call(path)).json();
    assert.equal(restored[0].id, command.id);
    assert.equal((await call(path, "PUT", [])).status, 200);
    assert.deepEqual(await (await call(path)).json(), []);
    assert.equal((await (await call(guildPath)).json()).length, 1);
  } finally {
    await mock?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
