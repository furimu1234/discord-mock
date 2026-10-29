import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MockRuntime } from "../src/server.js";
const require = createRequire(import.meta.url);
const { startMock } = require("../dist/server.cjs") as { startMock(options: { port: number; statePath?: string }): Promise<MockRuntime> };

test("管理画面は専用認証・CSRF を要求しリソースと権限を JSON に保存する", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discord-mock-admin-ui-"));
  const path = join(dir, "state.json");
  const app = await startMock({ port: 0, statePath: path });
  try {
    const api = `${app.url}/_admin/ui/`;
    assert.equal((await fetch(`${api}state`)).status, 401);
    const wrong = await fetch(`${api}login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: "invalid" }),
    });
    assert.equal(wrong.status, 403);
    const login = await fetch(`${api}login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: app.adminSecret }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const { csrf } = await login.json() as { csrf: string };
    const request = (route: string, method: string, data?: unknown, validCsrf = true) => fetch(`${api}${route}`, {
      method,
      headers: { cookie, "content-type": "application/json", ...(validCsrf ? { "x-discord-mock-csrf": csrf } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    assert.equal((await request("guild", "PATCH", { name: "Forbidden" }, false)).status, 403);
    assert.equal((await request("guild", "PATCH", { name: "Test Guild" })).status, 200);
    const createdRole = await request("roles", "POST", { name: "Restricted", permissions: "0" });
    assert.equal(createdRole.status, 201);
    const role = await createdRole.json() as { id: string };
    const createdUser = await request("users", "POST", { username: "NewTester" });
    assert.equal(createdUser.status, 201);
    const user = await createdUser.json() as { id: string };
    const createdChannel = await request("channels", "POST", { name: "private", type: 0 });
    assert.equal(createdChannel.status, 201);
    const channel = await createdChannel.json() as { id: string };
    assert.equal((await request(`roles/${role.id}`, "PATCH", { permissions: "2048" })).status, 200);
    assert.equal((await request(`members/${user.id}`, "PATCH", { roles: [role.id] })).status, 200);
    assert.equal((await request(`channels/${channel.id}`, "PATCH", {
      permission_overwrites: [{ id: role.id, type: 0, allow: "0", deny: "1024" }],
    })).status, 200);
    assert.equal((await request(`roles/${role.id}`, "PATCH", { permissions: "-1" })).status, 400);
    assert.equal((await request(`roles/${app.testing.guild.id}`, "DELETE")).status, 400);
    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.equal(saved.guild.name, "Test Guild");
    assert.deepEqual(saved.members.find((m: { user: { id: string } }) => m.user.id === user.id).roles, [role.id]);
    assert.equal(saved.guild.channels.find((c: { id: string }) => c.id === channel.id).permission_overwrites[0].deny, "1024");
    assert.equal((await request(`channels/${channel.id}`, "DELETE")).status, 200);
    assert.equal((await request(`roles/${role.id}`, "DELETE")).status, 200);
    assert.equal((await request(`users/${user.id}`, "DELETE")).status, 200);
    const current = await (await request("state", "GET")).json() as { users: Array<{ id: string }> };
    assert.ok(!current.users.some((item) => item.id === user.id));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Electron の管理者セッションは独立して有効", async () => {
  const app = await startMock({ port: 0 });
  try {
    const cookie = `discord_mock_admin=${app.issueDesktopAdminSession()}`;
    const response = await fetch(`${app.url}/_admin/ui/state`, { headers: { cookie } });
    assert.equal(response.status, 200);
  } finally { await app.close(); }
});
