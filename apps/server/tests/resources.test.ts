import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs");

test("コードで作成したリソースを UI と JSON で共有し、並行作成と再読込で失わない", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-resources-"));
  const statePath = join(directory, "state.json");
  let runtime;
  try {
    runtime = await startMock({ port: 0, statePath });
    const mock = runtime.testing;
    const users = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        mock.users.create({ username: `テスター${index}` }),
      ),
    );
    const channel = await mock.channels.create({ name: "テスト用" });
    const role = await mock.roles.create({
      name: "担当者",
      permissions: "2048",
    });
    await mock.members.addRole(users[0].id, role.id);
    await mock.as(users[0]).sendMessage(channel.id, "保存するメッセージ");
    const session = await fetch(`${runtime.url}/_ui/session`);
    const cookie = session.headers.get("set-cookie").split(";")[0];
    const view = await (
      await fetch(`${runtime.url}/_ui/state`, { headers: { cookie } })
    ).json();
    assert.ok(
      users.every((user) => view.users.some((shown) => shown.id === user.id)),
    );
    assert.ok(view.guild.channels.some((shown) => shown.id === channel.id));
    assert.ok(view.guild.roles.some((shown) => shown.id === role.id));
    assert.equal(view.messages[channel.id][0].author.id, users[0].id);
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    assert.deepEqual(saved, mock.snapshot());
    await runtime.close();
    runtime = await startMock({ port: 0, statePath });
    assert.deepEqual(runtime.testing.snapshot(), saved);
    assert.deepEqual(runtime.testing.members.get(users[0].id).roles, [role.id]);
    assert.equal(runtime.testing.channels.get(channel.id).name, "テスト用");

    // 旧形式は参加情報とバージョンを補完する。読み込むだけでは書き換えない。
    await runtime.close();
    runtime = undefined;
    saved.members = undefined;
    saved.version = undefined;
    const legacy = JSON.stringify(saved);
    await writeFile(statePath, legacy);
    runtime = await startMock({ port: 0, statePath });
    assert.equal(runtime.testing.snapshot().version, 1);
    assert.equal(runtime.testing.members.list().length, saved.users.length + 1);
    assert.equal(await readFile(statePath, "utf8"), legacy);
  } finally {
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("壊れたリソースの参照・重複 ID を起動時に拒否し JSON を保存し直さない", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "discord-mock-invalid-resource-"),
  );
  const statePath = join(directory, "state.json");
  const runtime = await startMock({ port: 0 });
  try {
    const snapshot = runtime.testing.snapshot();
    const badRole = structuredClone(snapshot);
    badRole.members[0].roles = ["999999999000000001"];
    const duplicate = structuredClone(snapshot);
    duplicate.users.push({ ...duplicate.users[0] });
    const badOverwrite = structuredClone(snapshot);
    badOverwrite.guild.channels[0].permission_overwrites = [
      { id: "999999999000000001", type: 0, allow: "0", deny: "1024" },
    ];
    for (const fixture of [badRole, duplicate, badOverwrite]) {
      const json = JSON.stringify(fixture);
      await writeFile(statePath, json);
      await assert.rejects(startMock({ port: 0, statePath }));
      assert.equal(await readFile(statePath, "utf8"), json);
    }
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
