import { test, expect } from "../helpers/bot-test.js";

test("投稿するたびにレベルが増える", { users: "login" }, async ({ bot, user, actor }) => {
  const before = await bot.levels.get(user);
  await actor.sendMessage("こんにちは");
  const first = (before ?? 1) + 1;
  await expect.poll(() => bot.levels.get(user)).toBe(first);
  await actor.sendMessage("もう一度投稿");
  await expect.poll(() => bot.levels.get(user)).toBe(first + 1);
});

test("投稿していないユーザーのレベルは変わらない", { users: "login" }, async ({ bot, user, actor }) => {
  const other = bot.users.list().find((candidate) => !candidate.bot && candidate.id !== user.id);
  if (!other) throw new Error("比較対象のユーザーが必要です");
  const otherBefore = await bot.levels.get(other);
  const before = await bot.levels.get(user);
  await actor.sendMessage(`${user.username} だけが投稿`);
  await expect.poll(() => bot.levels.get(user)).toBe((before ?? 1) + 1);
  expect(await bot.levels.get(other)).toBe(otherBefore);
});
