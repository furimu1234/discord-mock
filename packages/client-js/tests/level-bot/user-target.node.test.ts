import assert from "node:assert/strict";
import { test } from "node:test";
import type { MockUser } from "dismock/e2e";
import { resolveTestUsers } from "dismock/e2e";

const users: MockUser[] = [
  {
    id: "123456789000000099",
    username: "Alice",
    bot: false,
    discriminator: "0",
    avatar: null,
  },
  {
    id: "123456789000000098",
    username: "Bob",
    bot: false,
    discriminator: "0",
    avatar: null,
  },
  {
    id: "123456789000000001",
    username: "MockBot",
    bot: true,
    discriminator: "0",
    avatar: null,
  },
];

test("all は Bot を除外した全ダミーユーザーを順番に返す", () => {
  assert.deepEqual(
    resolveTestUsers(users, "all").map((u) => u.username),
    ["Alice", "Bob"],
  );
});

test("login は Web で選択したユーザーIDだけを返す", () => {
  assert.deepEqual(resolveTestUsers(users, "login", users[1].id), [users[1]]);
  assert.throws(() => resolveTestUsers(users, "login"), /ログイン中/);
});

test("ID指定は対象だけを返し、未登録またはBot IDではエラーにする", () => {
  assert.deepEqual(resolveTestUsers(users, { id: users[0].id }), [users[0]]);
  assert.throws(
    () => resolveTestUsers(users, { id: "123456789000000077" }),
    /存在しない/,
  );
  assert.throws(
    () => resolveTestUsers(users, { id: users[2].id }),
    /存在しない/,
  );
  assert.throws(() => resolveTestUsers(users, "invalid" as never), /users は/);
});

test("複数IDは指定順に返し、空・重複・Bot・未登録IDを拒否する", () => {
  assert.deepEqual(
    resolveTestUsers(users, { ids: [users[1].id, users[0].id] }),
    [users[1], users[0]],
  );
  assert.deepEqual(resolveTestUsers(users, { ids: [users[0].id] }), [users[0]]);
  assert.throws(() => resolveTestUsers(users, { ids: [] }), /最低1件/);
  assert.throws(
    () => resolveTestUsers(users, { ids: [users[0].id, users[0].id] }),
    /重複/,
  );
  assert.throws(
    () => resolveTestUsers(users, { ids: [users[0].id, "123456789000000077"] }),
    /存在しない/,
  );
  assert.throws(
    () => resolveTestUsers(users, { ids: [users[0].id, users[2].id] }),
    /存在しない/,
  );
  assert.throws(() => resolveTestUsers(users, { ids: [""] }), /空でない/);
});
