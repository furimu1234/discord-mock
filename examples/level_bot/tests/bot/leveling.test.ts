import { test, expect } from "../helpers/bot-test.js";

test("投稿するたびにレベルが増える", { users: "login" }, async ({ bot, user, actor }) => {
  await actor.sendMessage("こんにちは");
  await expect.poll(() => bot.levels.get(user)).toBe(2);
  await actor.sendMessage("もう一度投稿");
  await expect.poll(() => bot.levels.get(user)).toBe(3);
});

test("投稿していないユーザーのレベルは変わらない", { users: "login" }, async ({ bot, user, actor }) => {
  const other = bot.users.list().find((candidate) => !candidate.bot && candidate.id !== user.id);
  if (!other) throw new Error("比較対象のユーザーが必要です");
  await bot.levels.set(other, 10);
  await actor.sendMessage(`${user.username} だけが投稿`);
  await expect.poll(() => bot.levels.get(user)).toBe(2);
  expect(await bot.levels.get(other)).toBe(10);
});
