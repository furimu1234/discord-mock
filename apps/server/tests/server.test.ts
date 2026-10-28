import assert from "node:assert/strict";
import {test} from "node:test";
import {createRequire} from "node:module";
import WebSocket from "ws";
const require = createRequire(import.meta.url);
const {startMock} = require("../dist/server.cjs");

test("REST is loopback-only, returns local gateway and synthetic resources", async () => {
  await assert.rejects(startMock({host:"0.0.0.0",port:0}), /loopback/);
  await assert.rejects(startMock({token:"real_token",port:0}), /synthetic/);
  const mock=await startMock({port:0});
  try {
    const headers = {authorization:`Bot ${mock.token}`};
    assert.equal((await fetch(`${mock.url}/api/v10/users/@me`)).status,401);
    const me=await (await fetch(`${mock.url}/api/v10/users/@me`,{headers})).json();
    assert.equal(me.bot,true);
    const gateway=await (await fetch(`${mock.url}/api/v10/gateway/bot`,{headers})).json();
    assert.match(gateway.url,/^ws:\/\/127\.0\.0\.1:/);
    const msg=await (await fetch(`${mock.url}/api/v10/channels/123456789000000002/messages`,{
      method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({content:"test"}),
    })).json();
    assert.equal(msg.content,"test");
    assert.equal((await fetch(`${mock.url}/_mock/state`)).status,403);
  } finally {await mock.close();}
});

test("Gateway Hello/Identify/Heartbeat/Ready/GuildCreate", async () => {
  const mock=await startMock({port:0});
  const socket=new WebSocket(`${mock.url.replace(/^http/,"ws")}/gateway`);
  try {
    const events=[];
    const ready = new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("gateway test timeout")),2500);
      socket.on("message",(raw)=>{
        const data=JSON.parse(raw.toString());
        events.push(data);
        if (data.op===10) {
          socket.send(JSON.stringify({op:1,d:null}));
          socket.send(JSON.stringify({op:2,d:{token:mock.token,intents:0,properties:{os:"test",browser:"test",device:"test"}}}));
        }
        if (data.t==="GUILD_CREATE") {clearTimeout(timer);resolve();}
      });
      socket.on("error",reject);
    });
    await ready;
    assert.ok(events.some((e)=>e.op===11));
    assert.ok(events.some((e)=>e.t==="READY"));
    assert.ok(events.some((e)=>e.t==="GUILD_CREATE"));
  } finally {socket.terminate(); await mock.close();}
});
