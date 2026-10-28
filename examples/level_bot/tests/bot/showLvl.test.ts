import { describe, test, expect } from "../helpers/bot-test.js";

describe("/レベル確認", () => {
  test("投稿したあとにコマンドでレベルを確認できる", { users: "login" }, async ({ bot, user, actor }) => {
    const before = await bot.levels.get(user);
    await actor.sendMessage("こんにちは");
    const expected = (before ?? 1) + 1;
    await expect.poll(() => bot.levels.get(user)).toBe(expected);

    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].title).toBe(`${user.username} | lvl`);
    expect(reply.embeds[0].fields?.[0].value).toBe(String(expected));
    expect(reply.embeds[0].footer?.text).toBe(`by ${user.id}`);
    expect(reply.interaction_metadata?.user.id).toBe(user.id);
  });

  test("実行した Guild のレベルを返し、レベルを変更しない", { users: "login" }, async ({ bot, user, actor }) => {
    // 別Guildのレコードは生成せず、実際の投稿で現在Guildのみレベルアップさせる。
    const before = await bot.levels.get(user);
    await actor.sendMessage("Guild固有レベルの検証");
    const expected = (before ?? 1) + 1;
    await expect.poll(() => bot.levels.get(user)).toBe(expected);
    expect(await bot.levels.get(user, "223456789000000000")).toBeUndefined();
    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].fields?.[0].value).toBe(String(expected));
    expect(await bot.levels.get(user)).toBe(expected);
  });

  test("実行者ごとに対応するレベルを返す", { users: "login" }, async ({ bot, user, actor }) => {
    const before = await bot.levels.get(user);
    await actor.sendMessage("実行者のレベルを上げる");
    const expected = (before ?? 1) + 1;
    await expect.poll(() => bot.levels.get(user)).toBe(expected);
    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].fields?.[0].value).toBe(String(expected));
    expect(reply.embeds[0].title).toBe(`${user.username} | lvl`);
    expect(reply.interaction_metadata?.user.id).toBe(user.id);
  });

  test("複数IDで指定した各ユーザーからレベル確認できる", {
    users: { ids: ["123456789000000098", "123456789000000099"] },
  }, async ({ bot, user, actor }) => {
    const before = await bot.levels.get(user);
    await actor.sendMessage("複数ユーザーのレベル確認");
    const expected = (before ?? 1) + 1;
    await expect.poll(() => bot.levels.get(user)).toBe(expected);
    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].title).toBe(`${user.username} | lvl`);
    expect(reply.embeds[0].fields?.[0].value).toBe(String(expected));
    expect(reply.interaction_metadata?.user.id).toBe(user.id);
  });

  test("任意のレベルを直接設定し、通常の投稿でさらにレベルアップできる", { users: "login" }, async ({ bot, user, actor }) => {
    await bot.levels.set(user, 7);
    expect(await bot.levels.get(user)).toBe(7);

    // 既存行の更新もでき、別Guildのレベルは現在Guildに影響しない。
    await bot.levels.set(user, 12);
    await bot.levels.set(user, 99, "223456789000000000");
    expect(await bot.levels.get(user)).toBe(12);
    expect(await bot.levels.get(user, "223456789000000000")).toBe(99);

    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].fields?.[0].value).toBe("12");

    await actor.sendMessage("直接設定したレベルから投稿で上げる");
    await expect.poll(() => bot.levels.get(user)).toBe(13);
    expect(await bot.levels.get(user, "223456789000000000")).toBe(99);
  });

  test("レベル未登録なら返信もレコード作成もしない", { users: "login" }, async ({ bot }) => {
    const user = await bot.users.create({ username: "未登録ユーザー" });
    await expect(bot.as(user).command("レベル確認", { timeoutMs: 250 })).rejects.toThrow("250ms");
    expect(await bot.levels.get(user)).toBeUndefined();
    expect(bot.messages()).toEqual([]);
  });
});
