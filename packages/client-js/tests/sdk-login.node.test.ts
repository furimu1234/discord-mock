import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test} from "node:test";
import {Client, GatewayIntentBits} from "discord.js";
const {disMockClient} = await import(new URL("../dist/index.js", import.meta.url).href);

const require = createRequire(import.meta.url);
const {startMock} = require("../../../apps/server/dist/server.cjs");

test("discord.js REST login resolves local Gateway and identifies using a synthetic token", {timeout:10000}, async () => {
  const server=await startMock({port:0});
  const client=new Client({intents:[GatewayIntentBits.Guilds], waitGuildTimeout:200});
  try {
    const ut=disMockClient(client,{baseUrl:server.url});
    assert.equal(client.rest.options.api,`${server.url}/api`);
    const result=await Promise.race([
      ut.connect(server.token),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("mock SDK login timeout")),6000))
    ]);
    assert.equal(result,server.token);
    assert.equal(client.isReady(), true);
    const commands = await client.application.commands.set([{ name: "ping", description: "Global ping" }]);
    const command = commands.first();
    assert.equal(command.name, "ping");
    assert.equal(command.applicationId, client.application.id);
    assert.equal((await client.application.commands.fetch()).first().id, command.id);
    const guild = client.guilds.cache.first();
    const guildCommands = await guild.commands.set([{ name: "ping", description: "Guild ping" }]);
    assert.equal(guildCommands.first().guildId, guild.id);
    assert.notEqual(guildCommands.first().id, command.id);
    assert.equal((await guild.commands.fetch()).size, 1);
    await client.application.commands.set([]);
    assert.equal((await client.application.commands.fetch()).size, 0);
    assert.equal((await guild.commands.fetch()).size, 1);
  } finally {
    client.destroy();
    await server.close();
  }
});
