import type { TestContext } from "vitest";
import type {
  MockMessage,
  MockUser,
  TestEnvironment,
  TestEnvironmentOptions,
  WaitOptions,
} from "./testing-types.js";
import { createTestEnvironment, type BotTestExtensions } from "./testing.js";
import { resolveTestUsers, type TestUserTarget } from "./e2e-users.js";
import { localOrigin, readE2ERuntime } from "./e2e-runtime.js";

export interface BotActor extends MockUser {
  sendMessage(content: string): Promise<MockMessage>;
  command(name: string, options?: WaitOptions): Promise<MockMessage>;
}
export interface E2ERunningBot {
  failures?: readonly unknown[];
  close(): Promise<void>;
}
export interface E2EStartContext {
  mock: TestEnvironment;
  databaseDsn?: string;
  task: TestContext["task"];
}
export interface E2EOptions<Extensions extends object = BotTestExtensions> {
  start(context: E2EStartContext): Promise<E2ERunningBot>;
  extend?(
    context: E2EStartContext,
    running: E2ERunningBot,
  ): Extensions | Promise<Extensions>;
  environment?: Omit<TestEnvironmentOptions, "reportTo">;
  channel?: string;
}
export interface E2EBotBase {
  mock: TestEnvironment;
  guild: TestEnvironment["guild"];
  users: TestEnvironment["users"];
  channels: TestEnvironment["channels"];
  roles: TestEnvironment["roles"];
  channel: ReturnType<TestEnvironment["channels"]["list"]>[number];
  messages(): MockMessage[];
  as(user: MockUser): BotActor;
}
export type E2EBot = E2EBotBase & BotTestExtensions;
export type BotCaseContext = { bot: E2EBot; actor: BotActor };
export interface E2ERunner {
  test: typeof import("vitest").test;
  expect: typeof import("vitest").expect;
  describe: typeof import("vitest").describe;
  inject: typeof import("vitest").inject;
}
type RegisterTest = (
  name: string,
  options: { users: TestUserTarget },
  execute: (context: BotCaseContext) => Promise<void>,
) => void;
interface E2EState {
  options?: E2EOptions<object>;
  runner?: E2ERunner;
  register?: RegisterTest;
}
const KEY = Symbol.for("dismock.e2e.v1");
const host = process as typeof process & { [KEY]?: E2EState };
function state(): E2EState {
  host[KEY] ??= {};
  return host[KEY];
}

export function configureE2E<Extensions extends object>(
  options: E2EOptions<Extensions>,
): void {
  if (typeof options.start !== "function")
    throw new TypeError("テスト用 Bot の start 関数を指定してください");
  state().options = options;
  state().register = undefined;
}
/** 配布した Vitest setup から呼び、通常の Node.js import に Vitest を要求しない。 */
export function installE2ERunner(runner: E2ERunner): void {
  state().runner = runner;
  state().register = undefined;
}
function runner(): E2ERunner {
  const runtime = state().runner;
  if (!runtime)
    throw new Error(
      "defineE2EConfig() を使って Vitest からテストを実行してください",
    );
  return runtime;
}

function createActor(
  mock: TestEnvironment,
  channelId: string,
  user: MockUser,
): BotActor {
  const actor = mock.as(user);
  return {
    ...user,
    sendMessage: (content) => actor.sendMessage(channelId, content),
    command: (name, options) => actor.runCommand(channelId, name, options),
  };
}

async function syncChannels(mock: TestEnvironment, baseUrl: string) {
  const origin = localOrigin(baseUrl);
  const response = await fetch(new URL("/_ui/session", origin), {
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!response.ok || !cookie)
    throw new Error("テスト用ブラウザセッションを取得できません");
  const result = await fetch(new URL("/_ui/state", origin), {
    headers: { cookie },
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (!result.ok) throw new Error("テスト画面のチャンネル一覧を取得できません");
  const value = (await result.json()) as {
    guild?: { channels?: Array<{ id: string; name: string; type: number }> };
  };
  if (!Array.isArray(value.guild?.channels))
    throw new Error("テスト画面のチャンネル一覧が不正です");
  for (const channel of value.guild.channels) {
    if (
      (channel.type === 0 || channel.type === 2) &&
      !mock.channels.get(channel.id)
    )
      await mock.channels.create({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      });
  }
}

function buildTest(
  options: E2EOptions<object>,
  runtime: E2ERunner,
): RegisterTest {
  async function setupBot(
    { task }: TestContext,
    { onCleanup }: { onCleanup(callback: () => Promise<void>): void },
  ): Promise<E2EBot> {
    const reportUrl = process.env.DISCORD_MOCK_REPORT_URL;
    const connection =
      reportUrl && process.env.DISMOCK_RUNTIME_FILE
        ? await readE2ERuntime(process.env.DISMOCK_RUNTIME_FILE)
        : undefined;
    if (connection && connection.url !== reportUrl)
      throw new Error("実行中 App とテストの表示先が一致しません");
    const databaseDsn =
      connection?.postgresDsn ??
      (process.env.DISMOCK_SHARED_DATABASE
        ? runtime.inject("mockDbDsn")
        : undefined);
    const mock = await createTestEnvironment({
      ...options.environment,
      reportTo: reportUrl ? { baseUrl: reportUrl, name: task.name } : undefined,
    });
    let running: E2ERunningBot | undefined = undefined;
    let prepared = false;
    onCleanup(async () => {
      let closeError: unknown;
      try {
        await running?.close();
      } catch (error) {
        closeError = error;
      }
      const failures = running?.failures ?? [];
      const failed =
        !prepared ||
        Boolean(closeError) ||
        failures.length > 0 ||
        (task.result?.errors?.length ?? 0) > 0;
      try {
        await mock.report({
          status: failed ? "failed" : "passed",
          step: failed ? "検証失敗（詳細はターミナル）" : "検証完了",
        });
      } finally {
        await mock.close();
      }
      if (closeError) throw closeError;
      if (failures.length)
        throw new AggregateError(failures, "Bot のイベント処理が失敗しました");
    });
    if (reportUrl) await syncChannels(mock, reportUrl);
    await mock.report({ step: "テスト用 Bot を起動" });
    const context = { mock, databaseDsn, task };
    running = await options.start(context);
    const channel = mock.channels.findByName(options.channel ?? "general");
    if (!channel || channel.type !== 0)
      throw new Error("テスト用テキストチャンネルが見つかりません");
    const base: E2EBotBase = {
      mock,
      guild: mock.guild,
      channel,
      users: mock.users,
      channels: mock.channels,
      roles: mock.roles,
      messages: () => mock.messages.list(channel.id),
      as: (user) => createActor(mock, channel.id, user),
    };
    const extensions = (await options.extend?.(context, running)) ?? {};
    for (const key of Object.keys(extensions))
      if (key in base)
        throw new Error(`Bot の拡張 API が標準の ${key} と重複しています`);
    prepared = true;
    return { ...base, ...extensions } as E2EBot;
  }
  const base = runtime.test.extend("bot", setupBot);
  return (name, selection, execute) => {
    base(name, async ({ bot }) => {
      const users = resolveTestUsers(
        bot.users.list(),
        selection.users,
        process.env.DISCORD_MOCK_SELECTED_USER_ID,
      );
      for (const user of users) await execute({ bot, actor: bot.as(user) });
    });
  };
}

export const test: RegisterTest = (name, options, execute) => {
  const current = state();
  if (!current.options)
    throw new Error(
      "テスト用 Bot アダプターで configureE2E() を呼んでください",
    );
  current.register ??= buildTest(current.options, runner());
  current.register(name, options, execute);
};
export const it = test;
export const expect = new Proxy(
  (actual: unknown, message?: string) => runner().expect(actual, message),
  {
    get: (_target, property) => Reflect.get(runner().expect, property),
  },
) as typeof import("vitest").expect;
export const describe = new Proxy(
  (name: string, body: () => void) => runner().describe(name, body),
  {
    get: (_target, property) => Reflect.get(runner().describe, property),
  },
) as typeof import("vitest").describe;
