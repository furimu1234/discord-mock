import { test, expect } from "../helpers/bot-test.js";

test("レベル+1", { users: "login" }, async ({ bot, actor }) => {
  const before = await bot.levels.get(actor);
  await actor.sendMessage("こんにちは");
  const first = (before ?? 1) + 1;
  await expect.poll(() => bot.levels.get(actor)).toBe(first);
});

test(
  "投稿していないユーザーのレベルは変わらない",
  { users: "login" },
  async ({ bot, actor }) => {
    const other = bot.users
      .list()
      .find((candidate) => !candidate.bot && candidate.id !== actor.id);
    if (!other) throw new Error("比較対象のユーザーが必要です");
    const otherBefore = await bot.levels.get(other);
    const before = await bot.levels.get(actor);
    await actor.sendMessage(`${actor.username} だけが投稿`);
    await expect.poll(() => bot.levels.get(actor)).toBe((before ?? 1) + 1);
    expect(await bot.levels.get(other)).toBe(otherBefore);
  },
);
