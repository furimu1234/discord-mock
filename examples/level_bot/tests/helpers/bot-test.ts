import { test as base, expect, inject, type TestContext } from "vitest";
import {
  createTestEnvironment,
  type MockUser,
  type WaitOptions,
} from "@discord-mock/client-js/testing";
import { createLeveling, getLevel, updateLeveling } from "@ex/db";
import { container } from "../../packages/bot/src/container.js";
import { startLevelBot } from "../../packages/bot/src/local.js";
import { appPaths, readAppConnection } from "../../src/config.js";
import { resolveTestUsers, type TestUserTarget } from "./user-target.js";

type BotActor = ReturnType<typeof createBotActor>;
function createBotActor(mock: Awaited<ReturnType<typeof createTestEnvironment>>, channelId: string, user: MockUser) {
  const actor = mock.as(user);
  return {
    sendMessage: (content: string) => actor.sendMessage(channelId, content),
    command: (name: string, options?: WaitOptions) => actor.runCommand(channelId, name, options),
  };
}

export type { TestUserTarget } from "./user-target.js";

export { describe, expect } from "vitest";

/** Bot・Mockはケースごとに起動し、DBは同じApp／Vitest実行全体で共有する。 */
async function setupBot({ task }: TestContext, { onCleanup }: { onCleanup(callback: () => Promise<void>): void }) {
  const previousDsn = process.env.POST_URL;
  const baseUrl = process.env.DISCORD_MOCK_REPORT_URL;
  // App稼働時はApp自身が所有するPGliteを全テストとBotクライアントで共有する。
  // AppなしのVitestではglobalSetupが単一の一時PGliteを所有する。
  const connection = baseUrl ? await readAppConnection(appPaths().runtime) : undefined;
  if (connection && connection.url !== baseUrl)
    throw new Error("実行中Appとテストの表示先が一致しません。pnpm appを再起動してください");
  const databaseDsn = connection?.postgresDsn ?? inject("mockDbDsn");
  if (!databaseDsn) throw new Error("テスト用DBに接続できません。pnpm appを起動してください");
  const mock = await createTestEnvironment({
    reportTo: baseUrl ? { baseUrl, name: task.name } : undefined,
  });
  // 作成済みチャンネルをテスト側Mockにも取り込み、Bot操作で利用可能にする。
  if (baseUrl) {
    const sessionResponse = await fetch(new URL("/_ui/session", baseUrl));
    if (!sessionResponse.ok) throw new Error("テスト画面のチャンネル一覧を取得できません");
    const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("テスト用ブラウザセッションを取得できません");
    const stateResponse = await fetch(new URL("/_ui/state", baseUrl), { headers: { cookie } });
    if (!stateResponse.ok) throw new Error("テスト画面のチャンネル一覧を取得できません");
    const state = await stateResponse.json() as { guild: { channels: Array<{ id: string; name: string; type: number }> } };
    for (const channel of state.guild.channels) {
      if ((channel.type === 0 || channel.type === 2) && !mock.channels.get(channel.id)) {
        await mock.channels.create({ id: channel.id, name: channel.name, type: channel.type });
      }
    }
  }
  let running: Awaited<ReturnType<typeof startLevelBot>> | undefined = undefined;

  onCleanup(async () => {
    try {
      await running?.close();
      const failures = running?.failures ?? [];
      const failed =
        (task.result?.errors?.length ?? 0) > 0 || failures.length > 0;
      // AppではライブDBをDB画面から閲覧。単独実行でも同じDBをテスト全体で共有。
      await mock.report({
        status: failed ? "failed" : "passed",
        step: failed ? "検証失敗（詳細はターミナル）" : "検証完了",
      });
      expect(failures).toEqual([]);
    } finally {
      try {
        await mock.close();
      } finally {
        if (previousDsn === undefined)
          Reflect.deleteProperty(process.env, "POST_URL");
        else process.env.POST_URL = previousDsn;
      }
    }
  });

  await mock.report({ step: "テスト用 Bot を起動" });
  running = await startLevelBot(mock.url, mock.botToken, databaseDsn);
  const store = container.current?.getDataStore();
  const alice = mock.users.findByName("Alice");
  const bob = mock.users.findByName("Bob");
  const channel = mock.channels.findByName("general");
  if (!store || !alice || !bob || !channel)
    throw new Error("Bot テストの初期データを準備できませんでした");

  return {
    alice,
    bob,
    channel,
    users: mock.users,
    channels: mock.channels,
    roles: mock.roles,
    messages: () => mock.messages.list(channel.id),
    as(user: MockUser) {
      return createBotActor(mock, channel.id, user);
    },
    levels: {
      /** 必要なケースだけ、実際の共有PGliteへ初期値を挿入または更新する。 */
      async set(user: MockUser, level: number, guildId = mock.guild.id) {
        if (!Number.isInteger(level) || level < 0 || level > 2_147_483_647)
          throw new Error("level は0以上2147483647以下の整数を指定してください");
        await mock.report({ step: `${user.username} のレベルを ${level} に直接設定` });
        await store.do(async (db) => {
          const saved = await getLevel(db, { serverId: guildId, userId: user.id });
          if (saved) await updateLeveling(db, level, guildId, user.id);
          else await createLeveling(db, { serverId: guildId, userId: user.id, lvl: level });
        });
      },
      get: (user: MockUser, guildId = mock.guild.id) =>
        store.do(async (db) =>
          (await getLevel(db, { serverId: guildId, userId: user.id }))?.lvl,
        ),
    },
  };
}

/** テスト宣言側で選んだユーザーを操作・検証に共通して提供する。 */
const baseBotTest = base.extend("bot", setupBot);
type BotHarness = Awaited<ReturnType<typeof setupBot>>;
export type BotCaseContext = { bot: BotHarness; user: MockUser; actor: BotActor };
export function test(name: string, options: { users: TestUserTarget }, execute: (context: BotCaseContext) => Promise<void>): void {
  baseBotTest(name, async ({ bot }) => {
    const targets = resolveTestUsers(bot.users.list(), options.users, process.env.DISCORD_MOCK_SELECTED_USER_ID);
    for (const user of targets) await execute({ bot, user, actor: bot.as(user) });
  });
}
