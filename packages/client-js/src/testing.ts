/*!
 * この配布物に含む ws のライセンス表示。
 * https://github.com/websockets/ws
 *
 * Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>
 * Copyright (c) 2013 Arnout Kazemier and contributors
 * Copyright (c) 2016 Luigi Pinca and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { disMockClient } from "./index.js";
import { TestReporter } from "./test-reporter.js";
import type {
  MockTestController,
  TestBotClient,
  TestEnvironment,
  TestEnvironmentOptions,
} from "./testing-types.js";
export type * from "./testing-types.js";
export type * from "./test-runs.js";

interface TestRuntime {
  url: string;
  token: string;
  testing: MockTestController;
  close(): Promise<void>;
}
interface TestServerModule {
  startMock(
    options: TestEnvironmentOptions & {
      port: number;
      initialState?: TestEnvironmentOptions["fixture"];
    },
  ): Promise<TestRuntime>;
}

// ビルド時にサーバー・Web・ws を取り込み、このサブパスだけで実行できるようにする。
// 型は公開契約で定義し、SDK の型生成にサーバーのソースツリーを要求しない。
const { startMock } =
  require("../../../apps/server/src/server.ts") as TestServerModule;

async function withDeadline<T>(
  operation: Promise<T>,
  description: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`${description} が 3000ms 以内に完了しませんでした`),
            ),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** テストごとに独立したループバックサーバーを起動する。app / bot の別起動は不要。 */
export async function createTestEnvironment(
  options: TestEnvironmentOptions = {},
): Promise<TestEnvironment> {
  const reporter = options.reportTo ? new TestReporter(options.reportTo) : undefined;
  const runtime = await startMock({
    port: 0,
    initialState: options.fixture,
    now: options.now,
    timeoutMs: options.timeoutMs,
  });
  const controller = runtime.testing;
  let unsubscribe: (() => void) | undefined;
  try {
    if (reporter) {
      await reporter.start(controller.snapshot());
      unsubscribe = controller.subscribe((snapshot) => reporter.changed(snapshot));
    }
  } catch (error) {
    await runtime.close();
    throw error;
  }
  const clients = new Set<TestBotClient>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const assertOpen = () => {
    if (closed) throw new Error("テスト環境は終了しています");
  };
  const disconnect = async () => {
    const results = await Promise.allSettled(
      [...clients].map((client) =>
        withDeadline(
          Promise.resolve().then(() => client.destroy()),
          "Bot の切断",
        ),
      ),
    );
    clients.clear();
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
  };
  return {
    url: runtime.url,
    botToken: runtime.token,
    get guild() {
      return controller.guild;
    },
    users: controller.users,
    channels: controller.channels,
    roles: controller.roles,
    members: controller.members,
    messages: controller.messages,
    commands: controller.commands,
    as: (user) => {
      const actor = controller.as(user);
      const name = controller.users.get(typeof user === "string" ? user : user.id)?.username ?? "ユーザー";
      return {
        async sendMessage(channelId, content) {
          if (reporter) await reporter.report({ step: `${name} がメッセージを送信` }, controller.snapshot());
          return actor.sendMessage(channelId, content);
        },
        async runCommand(channelId, name, options) {
          if (reporter) await reporter.report({ step: `/${name} を実行` }, controller.snapshot());
          return actor.runCommand(channelId, name, options);
        },
      };
    },
    snapshot: () => controller.snapshot(),
    subscribe: (listener) => controller.subscribe(listener),
    async report(progress) {
      assertOpen();
      await reporter?.report(progress, controller.snapshot());
    },
    async connect(client) {
      assertOpen();
      if (clients.has(client))
        throw new Error("この Bot はすでに接続されています");
      clients.add(client);
      try {
        await withDeadline(
          disMockClient(client, { baseUrl: runtime.url }).connect(
            runtime.token,
          ),
          "Bot の接続",
        );
        return client;
      } catch (error) {
        await withDeadline(
          Promise.resolve().then(() => client.destroy()),
          "Bot の切断",
        ).catch(() => {});
        clients.delete(client);
        throw error;
      }
    },
    async reset() {
      assertOpen();
      await disconnect();
      await controller.reset();
    },
    close() {
      closed = true;
      closing ??= (async () => {
        unsubscribe?.();
        try {
          await reporter?.close(controller.snapshot());
        } finally {
          try { await disconnect(); }
          finally { await runtime.close(); }
        }
      })();
      return closing;
    },
  };
}
