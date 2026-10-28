import { describe, test, expect } from "../helpers/bot-test.js";

describe("/レベル確認", () => {
  test("投稿したあとにコマンドでレベルを確認できる", async ({ bot }) => {
    await bot.as(bot.alice).sendMessage("こんにちは");
    await expect.poll(() => bot.levels.get(bot.alice)).toBe(2);

    const reply = await bot.as(bot.alice).command("レベル確認");

    expect(reply.embeds[0].title).toBe("Alice | lvl");
    expect(reply.embeds[0].fields?.[0].value).toBe("2");
    expect(reply.embeds[0].footer?.text).toBe(`by ${bot.alice.id}`);
    expect(reply.interaction_metadata?.user.id).toBe(bot.alice.id);
  });

  test("実行した Guild のレベルを返し、レベルを変更しない", async ({ bot }) => {
    await bot.levels.set(bot.alice, 7);
    await bot.levels.set(bot.alice, 99, "223456789000000000");

    const reply = await bot.as(bot.alice).command("レベル確認");

    expect(reply.embeds[0].fields?.[0].value).toBe("7");
    expect(await bot.levels.get(bot.alice)).toBe(7);
  });

  test("実行者ごとに対応するレベルを返す", async ({ bot }) => {
    await bot.levels.set(bot.alice, 3);
    await bot.levels.set(bot.bob, 23);

    const replyA = await bot.as(bot.alice).command("レベル確認");
    const replyB = await bot.as(bot.bob).command("レベル確認");

    expect(replyA.embeds[0].fields?.[0].value).toBe("3");
    expect(replyA.interaction_metadata?.user.id).toBe(bot.alice.id);
    expect(replyB.embeds[0].fields?.[0].value).toBe("23");
    expect(replyB.interaction_metadata?.user.id).toBe(bot.bob.id);
  });

  test("レベル未登録なら返信もレコード作成もしない", async ({ bot }) => {
    const user = await bot.users.create({ username: "未登録ユーザー" });

    await expect(
      bot.as(user).command("レベル確認", { timeoutMs: 250 }),
    ).rejects.toThrow("250ms");

    expect(await bot.levels.get(user)).toBeUndefined();
    expect(bot.messages()).toEqual([]);
  });
});
