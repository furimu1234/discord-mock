import assert from "node:assert/strict";
import {test} from "node:test";
import {Client} from "discord.js";
import {SapphireClient} from "@sapphire/framework";
import {disMockClient, disMockMixin} from "../dist/index.js";

test("discord.js Client inherits all existing methods and uses local API route", () => {
  class MyBot extends Client { myMethod() {return 42;} }
  class TestBot extends disMockMixin(MyBot) {}
  const bot = new TestBot({intents:[]});
  try {
    assert.ok(bot instanceof MyBot);
    assert.equal(bot.myMethod(), 42);
    assert.equal(bot.mock.client, bot);
    assert.equal(bot.rest.options.api, "http://127.0.0.1:3000/api");
    const events = [];
    bot.on("testEvent", (v) => events.push(v));
    bot.mock.dispatch("testEvent", {userId:"1"});
    assert.equal(events.length, 1);
  } finally {bot.destroy();}
});
test("Sapphire instance is wrapped and configured in-place", () => {
  const bot = new SapphireClient({intents:[]});
  try {
    assert.strictEqual(disMockClient(bot).client, bot);
    assert.equal(bot.rest.options.api, "http://127.0.0.1:3000/api");
  } finally {bot.destroy();}
});
