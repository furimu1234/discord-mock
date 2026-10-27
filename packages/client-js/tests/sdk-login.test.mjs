import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test} from "node:test";
import {Client, GatewayIntentBits} from "discord.js";
import {disMockClient} from "../dist/index.js";

const require = createRequire(import.meta.url);
const {startMock} = require("../../../apps/server/dist/server.cjs");

test("discord.js REST login resolves local Gateway and identifies using a synthetic token", {timeout:10000}, async () => {
  const server=await startMock({port:0});
  const client=new Client({intents:[GatewayIntentBits.Guilds], waitGuildTimeout:200});
  try {
    const ut=disMockClient(client,{baseUrl:server.url});
    assert.equal(client.rest.options.api,server.url+"/api");
    const result=await Promise.race([
      ut.connect(server.token),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("mock SDK login timeout")),6000))
    ]);
    assert.equal(result,server.token);
  } finally {
    client.destroy();
    await server.close();
  }
});
