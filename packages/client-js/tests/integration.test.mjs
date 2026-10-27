import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, GatewayIntentBits } from "discord.js";
import { SapphireClient } from "@sapphire/framework";
import { DisMockClient, disMockClient, disMockMixin, disMockClientClass } from "../src/index.mjs";

test("discord.js existing Client can be wrapped without replacing its identity", () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const wrapped = disMockClient(client);
  assert.ok(wrapped instanceof DisMockClient);
  assert.strictEqual(wrapped.client, client);

  const seen = [];
  client.on("mockTestEvent", (payload) => seen.push(payload));
  const payload = { id: "dummy-user-1" };
  wrapped.dispatch("mockTestEvent", payload);
  assert.deepEqual(seen, [payload]);
  client.destroy();
});

test("discord.js custom subclass stays a subclass through the mixin", () => {
  class MyBot extends Client {
    constructor(options) {
      super(options);
      this.originalField = "kept";
    }
    customMethod() {
      return "original method";
    }
  }
  class UtBot extends disMockMixin(MyBot) {}
  const bot = new UtBot({ intents: [GatewayIntentBits.Guilds] });
  assert.ok(bot instanceof MyBot);
  assert.ok(bot instanceof Client);
  assert.equal(bot.customMethod(), "original method");
  assert.equal(bot.originalField, "kept");
  assert.strictEqual(bot.mock.client, bot);
  assert.strictEqual(bot.mock, bot.mock);
  bot.destroy();
});

test("SapphireClient supports both wrapping and inheritance", () => {
  const wrappedSapphire = new SapphireClient({ intents: [GatewayIntentBits.Guilds] });
  const wrapper = disMockClient(wrappedSapphire);
  assert.strictEqual(wrapper.client, wrappedSapphire);

  class MySapphireBot extends SapphireClient {
    myMethod() {
      return 42;
    }
  }
  class UtSapphireBot extends disMockClientClass(MySapphireBot) {}
  const bot = new UtSapphireBot({ intents: [GatewayIntentBits.Guilds] });
  assert.ok(bot instanceof SapphireClient);
  assert.ok(bot instanceof MySapphireBot);
  assert.equal(bot.myMethod(), 42);

  const results = [];
  bot.on("customMockEvent", (value) => results.push(value));
  bot.mock.emit("customMockEvent", "hello");
  assert.deepEqual(results, ["hello"]);

  wrappedSapphire.destroy();
  bot.destroy();
});

test("the integration refuses clients without the public emit method", () => {
  assert.throws(() => disMockClient({}), /requires a discord.js\/Sapphire-style client/);
  assert.throws(() => disMockMixin(class Wrong {}), /expects a client class/);
  assert.throws(() => disMockClient({ emit() {} }).dispatch(""), /non-empty string/);
});
