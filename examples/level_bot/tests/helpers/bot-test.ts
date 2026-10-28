import { test as base, expect, type TestContext } from "vitest";
import {
  createTestEnvironment,
  type MockUser,
  type WaitOptions,
} from "@discord-mock/client-js/testing";
import { createLeveling, getLevel, updateLeveling } from "@ex/db";
import { container } from "../../packages/bot/src/container.js";
import { startLevelBot } from "../../packages/bot/src/local.js";
import { startEphemeralDatabase } from "../../src/database.js";
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

/** Bot・DB・Mock はテストごとに新しく作り、本文は操作と検証だけを書く。 */
async function setupBot({ task }: TestContext, { onCleanup }: { onCleanup(callback: () => Promise<void>): void }) {
  const previousDsn = process.env.POST_URL;
  const baseUrl = process.env.DISCORD_MOCK_REPORT_URL;
  const mock = await createTestEnvironment({
    reportTo: baseUrl ? { baseUrl, name: task.name } : undefined,
  });
  let database: Awaited<ReturnType<typeof startEphemeralDatabase>> | undefined = undefined;
  let running: Awaited<ReturnType<typeof startLevelBot>> | undefined = undefined;

  onCleanup(async () => {
    try {
      await running?.close();
      const failures = running?.failures ?? [];
      const failed =
        (task.result?.errors?.length ?? 0) > 0 || failures.length > 0;
      await mock.report({
        status: failed ? "failed" : "passed",
        step: failed ? "検証失敗（詳細はターミナル）" : "検証完了",
      });
      expect(failures).toEqual([]);
    } finally {
      try {
        await mock.close();
      } finally {
        try {
          await database?.close();
        } finally {
          if (previousDsn === undefined)
            Reflect.deleteProperty(process.env, "POST_URL");
          else process.env.POST_URL = previousDsn;
        }
      }
    }
  });

  await mock.report({ step: "テスト用 Bot を起動" });
  database = await startEphemeralDatabase();
  running = await startLevelBot(mock.url, mock.botToken, database.dsn);
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
      async set(user: MockUser, level: number, guildId = mock.guild.id) {
        await mock.report({
          step: `${user.username} のレベルを ${level} に設定`,
        });
        await store.do(async (db) => {
          const saved = await getLevel(db, {
            serverId: guildId,
            userId: user.id,
          });
          if (saved) await updateLeveling(db, level, guildId, user.id);
          else
            await createLeveling(db, {
              serverId: guildId,
              userId: user.id,
              lvl: level,
            });
        });
      },
      get: (user: MockUser) =>
        store.do(
          async (db) =>
            (await getLevel(db, { serverId: mock.guild.id, userId: user.id }))
              ?.lvl,
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
