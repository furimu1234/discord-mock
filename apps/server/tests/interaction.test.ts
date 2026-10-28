import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test} from "node:test";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const {startMock} = require("../dist/server.cjs");

test("Synthetic user command reaches Gateway and callback is stored locally", {timeout:10000}, async () => {
  const mock = await startMock({port:0});
  const socket = new WebSocket(`${mock.url.replace("http:","ws:")}/gateway`);
  const botHeaders = {authorization: `Bot ${mock.token}`, "content-type": "application/json"};
  const adminHeaders = {"x-discord-mock-secret": mock.adminSecret, "content-type": "application/json"};
  let interactionId: string | undefined;
  try {
    const completed = new Promise<void>((resolve,reject) => {
      const timer = setTimeout(()=>reject(new Error("No mock interaction received")),5000);
      socket.on("error",reject);
      socket.on("message",async (bytes) => {
        try {
          const packet = JSON.parse(bytes.toString());
          if(packet.op === 10) socket.send(JSON.stringify({op:2,d:{token:mock.token,intents:0,properties:{os:"test",browser:"test",device:"test"}}}));
          if(packet.t === "GUILD_CREATE") {
            const res = await fetch(`${mock.url}/_mock/interaction`,{
              method:"POST", headers:adminHeaders, body:JSON.stringify({name:"ping",user_id:"123456789000000099"})
            });
            assert.equal(res.status,200);
            interactionId=(await res.json()).id;
          }
          if(packet.t === "INTERACTION_CREATE") {
            assert.equal(packet.d.type,2);
            assert.equal(packet.d.member.user.id,"123456789000000099");
            const response = await fetch(`${mock.url}/api/v10/interactions/${packet.d.id}/${packet.d.token}/callback`,{
              method:"POST",headers:botHeaders,body:JSON.stringify({type:4,data:{content:"Pong!"}})
            });
            assert.equal(response.status,204);
            clearTimeout(timer);
            resolve();
          }
        } catch(e) {clearTimeout(timer); reject(e);}
      });
    });
    await completed;
    const result = await (await fetch(`${mock.url}/_mock/interactions/${interactionId}`,{headers:adminHeaders})).json();
    assert.equal(result.replied,true);
    assert.equal(result.response.data.content,"Pong!");
  } finally {socket.terminate();await mock.close();}
});
