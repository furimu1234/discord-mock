import * as disMock from "dismock/client";
import type * as BotModule from "./main.js";
import { monitorApp, runTestClient, type MockUser } from "dismock/e2e";
import { createLeveling, getLevel, updateLeveling } from "@ex/db";

let instance = 0;
let active = false;
let container: typeof import("./container.js").container | undefined;

/** Bot 本文を変更せず、テスト専用の起動・DB設定・終了処理をまとめる。 */
export async function startLevelBot(
  baseUrl: string,
  token: string,
  postgresDsn: string,
  options: { onDatabaseDisconnect?: () => void } = {},
) {
  if (!/^mock_[a-zA-Z0-9_-]+$/.test(token))
    throw new Error(
      "Only synthetic mock_ tokens are allowed in the local runner",
    );
  if (!/^postgres(ql)?:\/\/[^\s]+$/.test(postgresDsn))
    throw new Error("A PostgreSQL connection string is required");
  if (active) throw new Error("共有DBの Bot は順番に起動・終了してください");
  active = true;
  const previousDsn = process.env.POST_URL;
  process.env.POST_URL = postgresDsn;
  let client: typeof BotModule.client | undefined;
  let stopMonitor = () => {};
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      stopMonitor();
      try {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => client?.destroy()),
          Promise.resolve().then(() => container?.current?.close()),
          new Promise<void>((resolve, reject) => {
            const logger = container?.current?.logger;
            if (!logger) {
              resolve();
              return;
            }
            logger.flush((error) => {
              if (error) reject(error);
              else resolve();
            });
          }),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      } finally {
        if (container) container.current = undefined;
        if (previousDsn === undefined)
          Reflect.deleteProperty(process.env, "POST_URL");
        else process.env.POST_URL = previousDsn;
        active = false;
      }
    })();
    return closing;
  };
  try {
    // App の接続設定を確定してから、既存 Bot の .env 読込を伴うモジュールを読み込む。
    ({ container } = await import("./container.js"));
    // singleton を export する既存 Bot でも、ケースごとにイベント登録から分離する。
    const module = (await import(
      /* @vite-ignore */ `./main.js?mock=${++instance}`
    )) as typeof BotModule;
    client = module.client;
    const testClient = disMock.Client(client, module.main, { baseUrl });
    const { failures } = await testClient(token);
    if (options.onDatabaseDisconnect)
      stopMonitor = monitorApp(baseUrl, options.onDatabaseDisconnect);
    return { client, failures, close };
  } catch (error) {
    await close();
    throw error;
  }
}

interface LevelAssertions {
  set(user: MockUser, level: number, guildId?: string): Promise<void>;
  get(user: MockUser, guildId?: string): Promise<number | undefined>;
}

declare module "dismock/e2e" {
  interface BotTestExtensions {
    levels: LevelAssertions;
  }
}

// Bot 固有の起動と DB 検証だけをここへ置き、テストの共通処理は dismock に任せる。
export const databaseOptions = {
  sql: `
  CREATE SCHEMA IF NOT EXISTS example;
  CREATE TABLE IF NOT EXISTS example.lvl (
    id serial PRIMARY KEY, server_id varchar(19) NOT NULL,
    user_id varchar(19) NOT NULL, lvl integer NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_idx ON example.lvl(user_id, server_id);
`,
};

await runTestClient(import.meta.url, {
  name: "level_bot",
  tsconfig: "packages/bot/tsconfig.json",
  database: databaseOptions,
  async bot({ url, token, databaseDsn, onDisconnect }) {
    if (!databaseDsn) throw new Error("テスト用 DB に接続できません");
    return startLevelBot(url, token, databaseDsn, {
      onDatabaseDisconnect: onDisconnect,
    });
  },
  extend({ mock }) {
    const store = container?.current?.getDataStore();
    if (!store) throw new Error("Bot の DB が初期化されていません");
    const levels: LevelAssertions = {
      async set(user, level, guildId = mock.guild.id) {
        if (!Number.isInteger(level) || level < 0 || level > 2_147_483_647)
          throw new Error(
            "level は0以上2147483647以下の整数を指定してください",
          );
        await mock.report({
          step: `${user.username} のレベルを ${level} に直接設定`,
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
      get: (user, guildId = mock.guild.id) =>
        store.do(
          async (db) =>
            (await getLevel(db, { serverId: guildId, userId: user.id }))?.lvl,
        ),
    };
    return { levels };
  },
});
