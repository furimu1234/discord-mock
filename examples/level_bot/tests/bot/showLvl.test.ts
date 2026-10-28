import { describe, test, expect } from "../helpers/bot-test.js";

describe("/レベル確認", () => {
  test("投稿したあとにコマンドでレベルを確認できる", { users: "login" }, async ({ bot, user, actor }) => {
    await actor.sendMessage("こんにちは");
    await expect.poll(() => bot.levels.get(user)).toBe(2);
    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].title).toBe(`${user.username} | lvl`);
    expect(reply.embeds[0].fields?.[0].value).toBe("2");
    expect(reply.embeds[0].footer?.text).toBe(`by ${user.id}`);
    expect(reply.interaction_metadata?.user.id).toBe(user.id);
  });

  test("実行した Guild のレベルを返し、レベルを変更しない", { users: "login" }, async ({ bot, user, actor }) => {
    await bot.levels.set(user, 7);
    await bot.levels.set(user, 99, "223456789000000000");
    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].fields?.[0].value).toBe("7");
    expect(await bot.levels.get(user)).toBe(7);
  });

  test("実行者ごとに対応するレベルを返す", { users: "login" }, async ({ bot, user, actor }) => {
    await bot.levels.set(user, 23);
    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].fields?.[0].value).toBe("23");
    expect(reply.embeds[0].title).toBe(`${user.username} | lvl`);
    expect(reply.interaction_metadata?.user.id).toBe(user.id);
  });

  test("レベル未登録なら返信もレコード作成もしない", { users: "login" }, async ({ bot }) => {
    const user = await bot.users.create({ username: "未登録ユーザー" });
    await expect(bot.as(user).command("レベル確認", { timeoutMs: 250 })).rejects.toThrow("250ms");
    expect(await bot.levels.get(user)).toBeUndefined();
    expect(bot.messages()).toEqual([]);
  });
});
