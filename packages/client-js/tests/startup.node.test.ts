import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Client as DiscordClient, Events, GatewayIntentBits } from "discord.js";
import { SapphireClient } from "@sapphire/framework";
import { Client as mockClient } from "../dist/index.js";
import { createTestEnvironment } from "dismock/e2e";

class Bot extends EventEmitter {
  rest = { options: { api: "https://discord.com/api" } };
  tokens: string[] = [];
  destroyed = false;
  async login(token?: string) {
    assert.equal(this.rest.options.api, "http://127.0.0.1:3000/api");
    assert.ok(token);
    this.tokens.push(token);
    this.emit("clientReady", this);
    return token;
  }
  destroy() {
    this.destroyed = true;
  }
  customMethod() {
    return "既存メソッド";
  }
}

test("既存 main の login と connect を一度にまとめ、非同期 Ready と戻り値を維持する", async () => {
  const bot = new Bot();
  const login = bot.login;
  const events: string[] = [];
  const listener = () => {
    events.push("on");
  };
  bot.on("clientReady", listener);
  bot.once("clientReady", async (ready) => {
    assert.equal(ready, bot);
    await delay(20);
    events.push("once");
  });
  const main = async (client: Bot, connect: () => Promise<unknown>) => {
    assert.equal(client, bot);
    assert.equal(client.customMethod(), "既存メソッド");
    await Promise.all([connect(), client.login("既存 main が保持する値")]);
    return { failures: [] as unknown[], value: 42 };
  };
  const result = await mockClient(bot, main)("mock_test");
  assert.deepEqual(result, { failures: [], value: 42 });
  assert.deepEqual(bot.tokens, ["mock_test"]);
  assert.deepEqual(events, ["on", "once"]);
  assert.equal(bot.login, login);
  assert.equal(Object.hasOwn(bot, "login"), false);
  assert.deepEqual(bot.listeners("clientReady"), [listener]);
  bot.emit("clientReady", bot);
  assert.deepEqual(events, ["on", "once", "on"]);
});

test("不正な URL と実トークンは main・login・REST 変更の前に拒否する", async () => {
  const bot = new Bot();
  const main = async () => {
    throw new Error("main を実行してはいけません");
  };
  assert.throws(
    () => mockClient(bot, main, { baseUrl: "https://discord.com" }),
    /loopback/,
  );
  await assert.rejects(mockClient(bot, main)("production-token"), /synthetic/);
  assert.deepEqual(bot.tokens, []);
  assert.equal(bot.rest.options.api, "https://discord.com/api");
  assert.equal(bot.destroyed, false);
});

test("Ready 内のリスナー解除と追加の順序を維持する", async () => {
  const bot = new Bot();
  const events: string[] = [];
  const removed = () => {
    events.push("removed");
  };
  const added = () => {
    events.push("added");
  };
  function first(this: Bot) {
    assert.equal(this, bot);
    events.push("first");
    this.removeListener("clientReady", first);
    this.removeListener("clientReady", removed);
    this.on("clientReady", added);
  }
  const retained = () => {
    events.push("retained");
  };
  bot.on("clientReady", first);
  bot.once("clientReady", removed);
  bot.on("clientReady", retained);
  await mockClient(bot, () => bot.login())("mock_test");
  assert.deepEqual(events, ["first", "removed", "retained"]);
  assert.deepEqual(bot.listeners("clientReady"), [retained, added]);
  bot.emit("clientReady");
  assert.deepEqual(events, [
    "first",
    "removed",
    "retained",
    "retained",
    "added",
  ]);
});

test("非同期 Ready の失敗を起動側に返し、未発火の once は保持する", async () => {
  const bot = new Bot();
  const failure = new Error("Ready 初期化失敗");
  bot.once("clientReady", async () => {
    await delay(10);
    throw failure;
  });
  const login = bot.login;
  await assert.rejects(
    mockClient(bot, () => bot.login())("mock_test"),
    (error) => error === failure,
  );
  assert.equal(bot.destroyed, true);
  assert.equal(bot.login, login);
  assert.deepEqual(bot.listeners("clientReady"), []);

  const waiting = new Bot();
  const listener = () => {};
  waiting.once("clientReady", listener);
  waiting.login = async () => {
    throw failure;
  };
  await assert.rejects(
    mockClient(waiting, () => waiting.login())("mock_test"),
    (error) => error === failure,
  );
  assert.deepEqual(waiting.listeners("clientReady"), [listener]);
});

test("同じ関数の複数登録も登録数と once を維持する", async () => {
  const bot = new Bot();
  let calls = 0;
  const listener = () => {
    calls++;
  };
  bot.on("clientReady", listener);
  bot.on("clientReady", listener);
  bot.once("clientReady", listener);
  await mockClient(bot, () => bot.login())("mock_test");
  assert.equal(calls, 3);
  assert.deepEqual(bot.listeners("clientReady"), [listener, listener]);
  bot.emit("clientReady");
  assert.equal(calls, 5);
});

test("login が Ready より先に解決しても、遅れて始まる非同期初期化を待つ", async () => {
  const bot = new Bot();
  bot.login = async (token) => {
    globalThis.setTimeout(() => bot.emit("clientReady", bot), 20);
    return token;
  };
  let initialized = false;
  bot.once("clientReady", async () => {
    await delay(20);
    initialized = true;
  });
  await mockClient(bot, () => bot.login())("mock_test");
  assert.equal(initialized, true);
});

test("起動失敗では独自 login の属性を戻し、Client を切断する", async () => {
  const bot = new Bot();
  const ownLogin = bot.login.bind(bot);
  Object.defineProperty(bot, "login", {
    value: ownLogin,
    configurable: true,
    enumerable: false,
  });
  const descriptor = Object.getOwnPropertyDescriptor(bot, "login");
  const failure = new Error("起動失敗");
  const start = mockClient(bot, async (client) => {
    await client.login();
    throw failure;
  });
  await assert.rejects(start("mock_test"), (error) => error === failure);
  assert.equal(bot.destroyed, true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(bot, "login"), descriptor);
  assert.equal(bot.rest.options.api, "http://127.0.0.1:3000/api");
});

test("同じ Client の同時起動は別のラッパーからも拒否する", async () => {
  const bot = new Bot();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const main = async (client: Bot) => {
    await client.login();
    await gate;
  };
  const first = mockClient(bot, main)("mock_first");
  try {
    await assert.rejects(mockClient(bot, main)("mock_second"), /実行中/);
  } finally {
    finish();
    await first;
  }
  assert.deepEqual(bot.tokens, ["mock_first"]);
});

for (const Base of [DiscordClient, SapphireClient]) {
  test(
    `${Base.name} の既存イベントと派生クラスをローカル REST/Gateway で維持する`,
    { timeout: 10_000 },
    async () => {
      const mock = await createTestEnvironment();
      class ExistingBot extends Base {
        customMethod() {
          return 42;
        }
      }
      const bot = new ExistingBot({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
        waitGuildTimeout: 200,
      });
      const failures: unknown[] = [];
      bot.on(Events.Error, (error) => {
        failures.push(error);
      });
      let initialized = false;
      bot.once(Events.ClientReady, async () => {
        await delay(25);
        initialized = true;
      });
      const actors: string[] = [];
      bot.on(Events.MessageCreate, (message) => {
        actors.push(message.author.id);
      });
      const login = bot.login;
      try {
        const start = mockClient(
          bot,
          async () => {
            await bot.login();
            return { failures };
          },
          { baseUrl: mock.url },
        );
        assert.equal((await start(mock.botToken)).failures, failures);
        assert.equal(initialized, true);
        assert.equal(bot instanceof Base, true);
        assert.equal(bot.customMethod(), 42);
        assert.equal(bot.login, login);
        assert.equal(bot.isReady(), true);
        assert.equal(bot.token, mock.botToken);
        assert.equal(bot.rest.options.api, `${mock.url}/api`);
        const channel = mock.channels.findByName("general");
        assert.ok(channel);
        for (const name of ["Alice", "Bob"]) {
          const user = mock.users.findByName(name);
          assert.ok(user);
          await mock.as(user).sendMessage(channel.id, name);
        }
        for (let attempt = 0; actors.length < 2 && attempt < 100; attempt++)
          await delay(10);
        assert.deepEqual(actors, [
          mock.users.findByName("Alice")?.id,
          mock.users.findByName("Bob")?.id,
        ]);
        assert.deepEqual(failures, []);
      } finally {
        await bot.destroy();
        await mock.close();
      }
    },
  );
}
