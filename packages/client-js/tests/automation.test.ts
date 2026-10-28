import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, Events, GatewayIntentBits } from "discord.js";
import {
  createTestEnvironment,
  type TestEnvironment,
} from "dismock/e2e";

function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value === null || value === undefined)
    throw new Error("テストに必要なリソースがありません");
  return value;
}

// この describe をコピーして、自分の Bot の生成処理に置き換えられる。
describe("Bot の自動テスト", () => {
  let mock: TestEnvironment;

  beforeEach(async () => {
    mock = await createTestEnvironment({
      now: () => new Date("2026-01-02T03:04:05Z"),
    });
  });
  afterEach(async () => {
    await mock.close();
  });

  it("ユーザー・チャンネル・ロールを作成し、既存データを取得できる", async () => {
    const alice = required(mock.users.findByName("Alice"));
    expect(mock.users.get(alice.id)).toEqual(alice);
    expect(mock.channels.findByName("general")?.type).toBe(0);
    expect(mock.roles.get(mock.guild.id)?.name).toBe("@everyone");

    const user = await mock.users.create({
      id: "223456789000000001",
      username: "テスト太郎",
    });
    const channel = await mock.channels.create({ name: "bot-test" });
    const role = await mock.roles.create({ name: "テスター", color: 0x123456 });
    await mock.members.addRole(user.id, role.id);
    expect(mock.members.get(user.id)?.roles).toEqual([role.id]);
    const message = await mock.as(user).sendMessage(channel.id, "こんにちは");
    expect(message.author.id).toBe(user.id);
    expect(message.timestamp).toBe("2026-01-02T03:04:05.000Z");
    expect(mock.messages.list(channel.id)).toEqual([message]);

    // 取得結果を書き換えても Mock の内部状態には影響しない。
    user.username = "書き換え";
    expect(mock.users.get(user.id)?.username).toBe("テスト太郎");
  });

  it("実際の discord.js Bot に投稿し、返信と実行者のロールを検証できる", async () => {
    const user = await mock.users.create({ username: "投稿者" });
    const channel = await mock.channels.create({ name: "message-test" });
    const role = await mock.roles.create({ name: "member" });
    await mock.members.addRole(user.id, role.id);
    const bot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    const seen: { userId: string; roleIds: string[] }[] = [];
    const errors: unknown[] = [];
    bot.on(Events.MessageCreate, (message) => {
      if (message.author.bot) return;
      seen.push({
        userId: message.author.id,
        roleIds: [...(message.member?.roles.cache.keys() ?? [])],
      });
      message.channel
        .send("こんにちは！")
        .catch((error: unknown) => errors.push(error));
    });
    await mock.connect(bot);

    const sent = await mock.as(user).sendMessage(channel.id, "hello");
    const reply = await mock.messages.waitFor({
      channelId: channel.id,
      authorId: required(bot.user).id,
      afterId: sent.id,
    });
    expect(reply.content).toBe("こんにちは！");
    expect(seen).toEqual([
      { userId: user.id, roleIds: expect.arrayContaining([role.id]) },
    ]);
    expect(errors).toEqual([]);
    expect(
      bot.guilds.cache.get(mock.guild.id)?.channels.cache.has(channel.id),
    ).toBe(true);
  });

  it("登録されたコマンドを A / B として実行し、それぞれの返信を待てる", async () => {
    const alice = required(mock.users.findByName("Alice"));
    const bob = required(mock.users.findByName("Bob"));
    const channel = required(mock.channels.findByName("general"));
    const role = await mock.roles.create({ name: "コマンド利用者" });
    await mock.members.addRole(bob.id, role.id);
    const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
    const errors: unknown[] = [];
    bot.once(Events.ClientReady, (client) => {
      client.application.commands
        .set([{ name: "ping", description: "動作確認" }])
        .catch((error: unknown) => errors.push(error));
    });
    bot.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      const roles = interaction.member?.roles;
      const roleIds = Array.isArray(roles)
        ? roles
        : [...(roles?.cache.keys() ?? [])].filter((id) => id !== mock.guild.id);
      interaction
        .reply(`${interaction.user.id}:${roleIds.join(",")}`)
        .catch((error: unknown) => errors.push(error));
    });
    await mock.connect(bot);
    await mock.commands.waitFor("ping");

    const [replyA, replyB] = await Promise.all([
      mock.as(alice).runCommand(channel.id, "ping"),
      mock.as(bob).runCommand(channel.id, "ping"),
    ]);
    expect(replyA.content).toBe(`${alice.id}:`);
    expect(replyB.content).toBe(`${bob.id}:${role.id}`);
    expect(replyA.interaction_metadata?.user.id).toBe(alice.id);
    expect(replyB.interaction_metadata?.user.id).toBe(bob.id);
    expect(replyA.interaction_metadata?.id).not.toBe(
      replyB.interaction_metadata?.id,
    );
    expect(errors).toEqual([]);
  });

  it("接続後に作成・付与したリソースも SDK の公開イベントに反映する", async () => {
    const bot = await mock.connect(
      new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
      }),
    );
    const role = await mock.roles.create({ name: "後から追加" });
    const user = await mock.users.create({ username: "後から参加" });
    const channel = await mock.channels.create({ name: "後から作成" });
    await mock.members.addRole(user.id, role.id);
    const guild = required(bot.guilds.cache.get(mock.guild.id));
    await expect.poll(() => guild.roles.cache.has(role.id)).toBe(true);
    await expect.poll(() => guild.channels.cache.has(channel.id)).toBe(true);
    await expect
      .poll(() => guild.members.cache.get(user.id)?.roles.cache.has(role.id))
      .toBe(true);
  });

  it("権限不足の操作とブラウザからの直接取得を拒否する", async () => {
    const bob = required(mock.users.findByName("Bob"));
    const channel = await mock.channels.create({
      name: "秘密",
      permissionOverwrites: [
        { id: mock.guild.id, type: 0, deny: "1024", allow: "0" },
      ],
    });
    await expect(
      mock.as(bob).sendMessage(channel.id, "見えないはず"),
    ).rejects.toThrow("権限");
    const sessionResponse = await fetch(`${mock.url}/_ui/session`);
    const { csrf } = await sessionResponse.json();
    const cookie = required(sessionResponse.headers.get("set-cookie")).split(
      ";",
    )[0];
    const headers = {
      cookie,
      "x-discord-mock-csrf": csrf,
      "content-type": "application/json",
    };
    await fetch(`${mock.url}/_ui/identity`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: bob.id }),
    });
    const state = await (
      await fetch(`${mock.url}/_ui/state`, { headers })
    ).json();
    expect(
      state.guild.channels.some(
        (item: { id: string }) => item.id === channel.id,
      ),
    ).toBe(false);
    expect(state.messages[channel.id]).toBeUndefined();
    const denied = await fetch(`${mock.url}/_ui/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel_id: channel.id, content: "直接投稿" }),
    });
    expect(denied.status).toBe(403);
    const registered = await fetch(
      `${mock.url}/api/v10/applications/${mock.snapshot().user.id}/commands`,
      {
        method: "PUT",
        headers: {
          authorization: `Bot ${mock.botToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify([{ name: "ping", description: "権限確認" }]),
      },
    );
    expect(registered.ok).toBe(true);
    await expect(mock.as(bob).runCommand(channel.id, "ping")).rejects.toThrow(
      "権限",
    );
    const deniedCommand = await fetch(`${mock.url}/_ui/interaction`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channel_id: channel.id, name: "ping" }),
    });
    expect(deniedCommand.status).toBe(403);
    const role = await mock.roles.create({ name: "閲覧可能" });
    // ロールの allow を持つ別チャンネルでは付与に応じて操作できる。
    const allowed = await mock.channels.create({
      name: "ロール専用",
      permissionOverwrites: [
        { id: mock.guild.id, type: 0, deny: "1024", allow: "0" },
        { id: role.id, type: 0, deny: "0", allow: "1024" },
      ],
    });
    await mock.members.addRole(bob.id, role.id);
    expect((await mock.as(bob).sendMessage(allowed.id, "見える")).content).toBe(
      "見える",
    );
  });

  it("不正な入力を保存せず、同名検索の曖昧さを検出する", async () => {
    const before = mock.snapshot();
    await expect(
      mock.users.create({ id: "invalid", username: "test" }),
    ).rejects.toThrow();
    await expect(
      mock.users.create({ id: mock.guild.id, username: "重複" }),
    ).rejects.toThrow("重複");
    await expect(mock.channels.create({ name: " " })).rejects.toThrow();
    await expect(
      mock.roles.create({ name: "bad", permissions: "-1" }),
    ).rejects.toThrow();
    await expect(
      mock.members.setRoles(before.users[0].id, ["999999999000000001"]),
    ).rejects.toThrow();
    expect(mock.snapshot()).toEqual(before);
    await mock.users.create({ username: "Alice" });
    expect(() => mock.users.findByName("Alice")).toThrow("複数");
    expect(mock.users.get("999999999000000001")).toBeUndefined();
  });

  it("待機に期限があり、reset と close で中断し Bot を切断できる", async () => {
    const channel = required(mock.channels.findByName("general"));
    await expect(
      mock.messages.waitFor({ channelId: channel.id, timeoutMs: 20 }),
    ).rejects.toThrow("20ms");
    const pending = expect(
      mock.messages.waitFor({ channelId: channel.id }),
    ).rejects.toThrow("リセット");
    const created = await mock.users.create({ username: "リセット対象" });
    const bot = await mock.connect(
      new Client({ intents: [GatewayIntentBits.Guilds] }),
    );
    await mock.reset();
    await pending;
    expect(bot.isReady()).toBe(false);
    expect(mock.users.get(created.id)).toBeUndefined();
    expect(mock.messages.list(channel.id)).toEqual([]);
    const closing = expect(mock.commands.waitFor("missing")).rejects.toThrow(
      "終了",
    );
    await mock.close();
    await closing;
    await expect(mock.users.create({ username: "終了後" })).rejects.toThrow(
      "終了",
    );
  });

  it("並列環境と JSON フィクスチャの状態を混在させない", async () => {
    const snapshot = mock.snapshot();
    const other = await createTestEnvironment({ fixture: snapshot });
    try {
      expect(other.url).not.toBe(mock.url);
      const role = await other.roles.create({ name: "他のテスト" });
      expect(mock.roles.get(role.id)).toBeUndefined();
      expect(snapshot.guild.roles).not.toContainEqual(role);
      snapshot.version = 2 as 1;
      await expect(
        createTestEnvironment({ fixture: snapshot }),
      ).rejects.toThrow("バージョン");
      const missingRole = mock.snapshot();
      missingRole.members[0].roles = [role.id];
      await expect(
        createTestEnvironment({ fixture: missingRole }),
      ).rejects.toThrow("ロール");
    } finally {
      await other.close();
    }
  });
});
