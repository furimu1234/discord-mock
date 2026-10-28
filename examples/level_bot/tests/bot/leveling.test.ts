import { test, expect } from "../helpers/bot-test.js";

test("投稿するたびにレベルが増える", async ({ bot }) => {
  await bot.as(bot.alice).sendMessage("こんにちは");
  await expect.poll(() => bot.levels.get(bot.alice)).toBe(2);

  await bot.as(bot.alice).sendMessage("もう一度投稿");
  await expect.poll(() => bot.levels.get(bot.alice)).toBe(3);
});

test("投稿していないユーザーのレベルは変わらない", async ({ bot }) => {
  await bot.levels.set(bot.bob, 10);

  await bot.as(bot.alice).sendMessage("Alice だけが投稿");

  await expect.poll(() => bot.levels.get(bot.alice)).toBe(2);
  expect(await bot.levels.get(bot.bob)).toBe(10);
});
