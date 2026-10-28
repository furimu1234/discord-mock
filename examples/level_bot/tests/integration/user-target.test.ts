import assert from "node:assert/strict";
import { test } from "node:test";
import type { MockUser } from "@discord-mock/client-js/testing";
import { resolveTestUsers } from "../helpers/user-target.js";

const users: MockUser[] = [
  { id: "123456789000000099", username: "Alice", bot: false, discriminator: "0", avatar: null },
  { id: "123456789000000098", username: "Bob", bot: false, discriminator: "0", avatar: null },
  { id: "123456789000000001", username: "MockBot", bot: true, discriminator: "0", avatar: null },
];

test("all は Bot を除外した全ダミーユーザーを順番に返す", () => {
  assert.deepEqual(resolveTestUsers(users, "all").map(u => u.username), ["Alice", "Bob"]);
});

test("logged-in は Web で選択したユーザーIDだけを返す", () => {
  assert.deepEqual(resolveTestUsers(users, "logged-in", users[1].id), [users[1]]);
  assert.throws(() => resolveTestUsers(users, "logged-in"), /ログイン中/);
});

test("ID指定は対象だけを返し、未登録またはBot IDではエラーにする", () => {
  assert.deepEqual(resolveTestUsers(users, { id: users[0].id }), [users[0]]);
  assert.throws(() => resolveTestUsers(users, { id: "123456789000000077" }), /存在しない/);
  assert.throws(() => resolveTestUsers(users, { id: users[2].id }), /存在しない/);
  assert.throws(() => resolveTestUsers(users, "invalid" as never), /users は/);
});
