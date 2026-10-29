import { describe, test, expect } from "dismock/e2e";

describe("/レベル確認", () => {
  test(
    "メッセージ投稿後レベルを確認",
    { users: "login" },
    async ({ bot, actor }) => {
      const before = await bot.levels.get(actor);
      await actor.sendMessage("こんにちは");
      const expected = (before ?? 0) + 1;
      await expect.poll(() => bot.levels.get(actor)).toBe(expected);

      const reply = await actor.command("レベル確認");
      expect(reply.embeds[0].title).toBe(`${actor.username} | lvl`);
      expect(reply.embeds[0].fields?.[0].value).toBe(String(expected));
      expect(reply.embeds[0].footer?.text).toBe(`by ${actor.id}`);
      expect(reply.interaction_metadata?.user.id).toBe(actor.id);
    },
  );

  test("表示だけ", { users: "login" }, async ({ bot, actor }) => {
    const expected = await bot.levels.get(actor);

    await expect.poll(() => bot.levels.get(actor)).toBe(expected);
    const reply = await actor.command("レベル確認");
    expect(reply.embeds[0].fields?.[0].value).toBe(String(expected));
    expect(reply.embeds[0].title).toBe(`${actor.username} | lvl`);
    expect(reply.interaction_metadata?.user.id).toBe(actor.id);
  });

  test(
    "複数人連続実行",
    {
      users: { ids: ["123456789000000098", "123456789000000099"] },
    },
    async ({ bot, actor }) => {
      const before = await bot.levels.get(actor);
      await actor.sendMessage("複数ユーザーのレベル確認");
      const expected = (before ?? 0) + 1;
      await expect.poll(() => bot.levels.get(actor)).toBe(expected);
      const reply = await actor.command("レベル確認");
      expect(reply.embeds[0].title).toBe(`${actor.username} | lvl`);
      expect(reply.embeds[0].fields?.[0].value).toBe(String(expected));
      expect(reply.interaction_metadata?.user.id).toBe(actor.id);
    },
  );

  describe("直接設定", () => {
    test("任意のレベルを指定", { users: "login" }, async ({ bot, actor }) => {
      await bot.levels.set(actor, 7);
      expect(await bot.levels.get(actor)).toBe(7);

      // 既存行の更新もでき、別Guildのレベルは現在Guildに影響しない。
      await bot.levels.set(actor, 12);
      await bot.levels.set(actor, 99, "223456789000000000");
      expect(await bot.levels.get(actor)).toBe(12);
      expect(await bot.levels.get(actor, "223456789000000000")).toBe(99);

      const reply = await actor.command("レベル確認");
      expect(reply.embeds[0].fields?.[0].value).toBe("12");

      await actor.sendMessage("直接設定したレベルから投稿で上げる");
      await expect.poll(() => bot.levels.get(actor)).toBe(13);
      expect(await bot.levels.get(actor, "223456789000000000")).toBe(99);
    });
  });

  test("未登録・実行無し", { users: "login" }, async ({ bot }) => {
    const actor = bot.as(
      await bot.users.create({ username: "未登録ユーザー" }),
    );
    await expect(
      actor.command("レベル確認", { timeoutMs: 250 }),
    ).rejects.toThrow("250ms");
    expect(await bot.levels.get(actor)).toBeUndefined();
    expect(bot.messages()).toEqual([]);
  });
});
