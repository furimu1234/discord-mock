import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { renderPage } from "../../web/src/page.js";

export type MockUser = { id: string; username: string; discriminator: string; avatar: null; bot: boolean };
export type MockChannel = { id: string; guild_id: string; name: string; type: number; position: number; permission_overwrites: unknown[] };
export type MockMessage = { id: string; channel_id: string; content: string; author: MockUser; timestamp: string; edited_timestamp: null; tts: boolean; mention_everyone: boolean; mentions: unknown[]; mention_roles: string[]; attachments: unknown[]; embeds: unknown[]; pinned: boolean; type: number; flags: number };
export type MockState = { user: MockUser; guild: { id: string; name: string; owner_id: string; roles: unknown[]; channels: MockChannel[] }; messages: Record<string, MockMessage[]> };

const LOCAL = new Set(["127.0.0.1", "::1"]);
const FALLBACK_CHANNEL = "123456789000000002";
const APP_ID = "123456789000000001";
function initialState(): MockState {
  const user: MockUser = { id: APP_ID, username: "MockBot", discriminator: "0", avatar: null, bot: true };
  const guildId = "123456789000000000";
  return {
    user,
    guild: {
      id: guildId, name: "Mock Guild", owner_id: "123456789000000099",
      roles: [{ id: guildId, name: "@everyone", color: 0, hoist: false, position: 0, permissions: "0", managed: false, mentionable: false }],
      channels: [{ id: FALLBACK_CHANNEL, guild_id: guildId, name: "general", type: 0, position: 0, permission_overwrites: [] }],
    },
    messages: { [FALLBACK_CHANNEL]: [] },
  };
}
function send(res: ServerResponse, status: number, data: unknown, more: Record<string,string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...more });
  res.end(JSON.stringify(data));
}
function error(res: ServerResponse, status: number, message: string) {
  send(res, status, { message, code: status === 401 ? 0 : 10003 });
}
async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > 64 * 1024) throw new Error("Request body exceeds 64KB");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}

export interface ServerOptions { host?: string; port?: number; statePath?: string; token?: string }
export interface MockRuntime { server: ReturnType<typeof createServer>; url: string; token: string; adminSecret: string; close(): Promise<void> }
export async function startMock(options: ServerOptions = {}): Promise<MockRuntime> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  if (!LOCAL.has(host)) throw new Error("Only loopback listeners are allowed");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be 0..65535");
  if (options.token && !options.token.startsWith("mock_")) throw new Error("Only synthetic mock_ tokens are allowed");
  const token = options.token ?? "mock_" + randomBytes(20).toString("hex");
  const adminSecret = randomBytes(20).toString("hex");
  const dataPath = options.statePath ? resolve(options.statePath) : null;
  let state = initialState();
  if (dataPath) {
    try {
      const raw = JSON.parse(await readFile(dataPath, "utf8")) as MockState;
      if (!raw?.user?.id || !raw?.guild?.id || !Array.isArray(raw.guild.channels) || !raw.messages || typeof raw.messages !== "object") throw new Error("Invalid mock state");
      state = raw;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  let nextId = BigInt(Date.now()) * 4_194_304n;
  const nextSnowflake = () => String(++nextId);
  const peers = new Set<{ ws: WebSocket; seq: number; identified: boolean; session: string }>();
  const interactions = new Map<string, { token: string; response?: Record<string, unknown> }>();
  async function persist() {
    if (!dataPath) return;
    await mkdir(dirname(dataPath), { recursive: true });
    const temp = dataPath + "." + randomBytes(6).toString("hex") + ".tmp";
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, dataPath);
  }
  function broadcast(name: string, data: unknown) {
    for (const peer of peers) {
      if (!peer.identified || peer.ws.readyState !== WebSocket.OPEN) continue;
      peer.ws.send(JSON.stringify({ op: 0, t: name, s: ++peer.seq, d: data }));
    }
  }
  function guildPayload() {
    return { ...state.guild, channels: state.guild.channels, members: [
      { user: state.user, roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false, flags: 0 },
    ], member_count: 1, large: false, unavailable: false, presences: [], voice_states: [], threads: [],
    emojis: [], stickers: [], features: [], afk_timeout: 300, verification_level: 0, default_message_notifications: 0,
    explicit_content_filter: 0, mfa_level: 0, nsfw_level: 0, premium_tier: 0,
    system_channel_flags: 0, preferred_locale: "en-US", owner: false };
  }
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Do not allow a different website to mutate or read the local mock.
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
      error(res, 403, "Cross-origin access denied"); return;
    }
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/api\/v\d+/, "");
    const isApi = (req.url ?? "").startsWith("/api/");
    try {
      if (method === "GET" && path === "/health") { send(res, 200, { status: "ok", service: "discord-mock" }); return; }
      if (method === "GET" && ["/", "/test", "/admin"].includes(path) && !isApi) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" });
        res.end(renderPage()); return;
      }
      if (method === "GET" && path === "/_mock/state") {
        if (req.headers["x-discord-mock-secret"] !== adminSecret) { error(res, 403, "Invalid mock admin secret"); return; }
        send(res, 200, state); return;
      }
      if (method === "POST" && path === "/_mock/dispatch") {
        if (req.headers["x-discord-mock-secret"] !== adminSecret) { error(res, 403, "Invalid mock admin secret"); return; }
        const body = await jsonBody(req);
        if (typeof body.event !== "string" || !/^[A-Z_]{1,80}$/.test(body.event)) { error(res, 400, "Invalid event"); return; }
        broadcast(body.event, body.data ?? {});
        send(res, 200, { dispatched: body.event }); return;
      }
      if (method === "POST" && path === "/_mock/interaction") {
        if (req.headers["x-discord-mock-secret"] !== adminSecret) { error(res, 403, "Invalid mock admin secret"); return; }
        const body = await jsonBody(req);
        const userId = typeof body.user_id === "string" && /^\d{17,20}$/.test(body.user_id)
          ? body.user_id : "123456789000000099";
        const channelId = typeof body.channel_id === "string" && state.guild.channels.some((c) => c.id === body.channel_id)
          ? body.channel_id : FALLBACK_CHANNEL;
        const customId = typeof body.custom_id === "string" ? body.custom_id : undefined;
        const commandName = typeof body.name === "string" && /^[\w-]{1,32}$/.test(body.name)
          ? body.name : "mock";
        if (customId && customId.length > 100) { error(res, 400, "Invalid custom ID"); return; }
        const id = nextSnowflake();
        const interactionToken = "mock_interaction_" + randomBytes(18).toString("hex");
        const actor: MockUser = { id: userId, username: "MockUser", discriminator: "0", avatar: null, bot: false };
        const interaction = {
          id, application_id: APP_ID, type: customId ? 3 : 2,
          data: customId
            ? { component_type: 2, custom_id: customId }
            : { id: nextSnowflake(), type: 1, name: commandName, options: [] },
          guild_id: state.guild.id, channel_id: channelId, token: interactionToken,
          version: 1, member: { user: actor, roles: [], permissions: "0", joined_at: new Date().toISOString(), flags: 0 },
          app_permissions: "0", locale: "ja", guild_locale: "ja",
        };
        interactions.set(id, { token: interactionToken });
        broadcast("INTERACTION_CREATE", interaction);
        send(res, 200, { id, data: interaction }); return;
      }
      const resultPath = path.match(/^\/_mock\/interactions\/(\d+)$/);
      if (method === "GET" && resultPath) {
        if (req.headers["x-discord-mock-secret"] !== adminSecret) { error(res, 403, "Invalid mock admin secret"); return; }
        const result = interactions.get(resultPath[1]);
        result ? send(res, 200, { replied: !!result.response, response: result.response ?? null }) : error(res, 404, "Unknown interaction");
        return;
      }
      if (!isApi) { error(res, 404, "Unknown mock route"); return; }
      if (req.headers.authorization !== `Bot ${token}`) { error(res, 401, "Use the synthetic token printed by discord-mock"); return; }
      const wsUrl = `ws://${host === "::1" ? "[::1]" : host}:${(server.address() as {port:number}).port}/gateway`;
      if (method === "GET" && (path === "/gateway" || path === "/gateway/bot")) {
        send(res, 200, path === "/gateway" ? { url: wsUrl } : {
          url: wsUrl, shards: 1, session_start_limit: { total: 1000, remaining: 1000, reset_after: 86_400_000, max_concurrency: 1 },
        }); return;
      }
      const callback = path.match(/^\/interactions\/(\d+)\/([^/]+)\/callback$/);
      if (method === "POST" && callback) {
        const item = interactions.get(callback[1]);
        if (!item || item.token !== callback[2]) { error(res, 404, "Unknown interaction"); return; }
        const reply = await jsonBody(req);
        if (!Number.isInteger(reply.type) || ![4,5,6,7,9].includes(reply.type as number)) {
          error(res, 400, "Unsupported interaction response type"); return;
        }
        item.response = reply;
        if (new URL(req.url ?? "/", "http://localhost").searchParams.get("with_response") === "true") {
          send(res, 200, { interaction: { id: callback[1], type: reply.type, response_message_id: null }, resource: null });
        } else {
          res.writeHead(204, { "cache-control": "no-store" }); res.end();
        }
        return;
      }
      if (method === "GET" && path === "/users/@me") { send(res, 200, state.user); return; }
      if (method === "GET" && path === "/oauth2/applications/@me") { send(res, 200, { id: APP_ID, name: "MockBot", bot: state.user, flags: 0, description: "" }); return; }
      if (method === "GET" && path === "/users/@me/guilds") { send(res, 200, [state.guild]); return; }
      if (method === "GET" && path === `/guilds/${state.guild.id}`) { send(res, 200, guildPayload()); return; }
      if (method === "GET" && path === `/guilds/${state.guild.id}/channels`) { send(res, 200, state.guild.channels); return; }
      const ch = path.match(/^\/channels\/(\d+)$/);
      if (method === "GET" && ch) {
        const channel = state.guild.channels.find((x) => x.id === ch[1]);
        channel ? send(res, 200, channel) : error(res, 404, "Unknown Channel"); return;
      }
      const messages = path.match(/^\/channels\/(\d+)\/messages$/);
      if (messages && state.guild.channels.some((x) => x.id === messages[1])) {
        if (method === "GET") { send(res, 200, [...(state.messages[messages[1]] ?? [])].reverse()); return; }
        if (method === "POST") {
          const body = await jsonBody(req);
          if (typeof body.content !== "string" || body.content.length > 2000) { error(res, 400, "Invalid content"); return; }
          const msg: MockMessage = {
            id: nextSnowflake(), channel_id: messages[1], content: body.content, author: state.user,
            timestamp: new Date().toISOString(), edited_timestamp: null, tts: false,
            mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [],
            pinned: false, type: 0, flags: 0,
          };
          (state.messages[messages[1]] ??= []).push(msg); await persist();
          broadcast("MESSAGE_CREATE", { ...msg, guild_id: state.guild.id }); send(res, 200, msg); return;
        }
      }
      error(res, 404, "Not implemented in discord-mock");
    } catch (e) {
      error(res, e instanceof SyntaxError || /64KB|JSON object required/.test(String(e)) ? 400 : 500, "Mock request failed");
    }
  });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const origin = req.headers.origin;
    if (path !== "/gateway" || (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin))) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws: WebSocket) => {
    const peer = { ws, seq: 0, identified: false, session: randomBytes(12).toString("hex") };
    peers.add(peer);
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 }, s: null, t: null }));
    ws.on("message", (raw: RawData) => {
      try {
        const obj = JSON.parse(raw.toString()) as { op: number; d?: any };
        if (obj.op === 1) { ws.send(JSON.stringify({ op: 11, d: null, s: null, t: null })); return; }
        if (obj.op === 2) {
          if (obj.d?.token !== token) { ws.close(4004, "invalid mock token"); return; }
          peer.identified = true;
          ws.send(JSON.stringify({ op: 0, t: "READY", s: ++peer.seq, d: {
            v: 10, user: state.user, guilds: [{ id: state.guild.id, unavailable: true }],
            session_id: peer.session, resume_gateway_url: wsUrl(), application: { id: APP_ID, flags: 0 },
            private_channels: [], shard: [0, 1], _trace: [],
          } }));
          ws.send(JSON.stringify({ op: 0, t: "GUILD_CREATE", s: ++peer.seq, d: guildPayload() }));
          return;
        }
        if (obj.op === 6 && obj.d?.session_id === peer.session) {
          peer.identified = true;
          ws.send(JSON.stringify({ op: 0, t: "RESUMED", s: ++peer.seq, d: { _trace: [] } })); return;
        }
        if (obj.op === 4 && peer.identified) {
          const voice = { guild_id: obj.d?.guild_id, channel_id: obj.d?.channel_id ?? null,
            user_id: state.user.id, session_id: peer.session, deaf: Boolean(obj.d?.self_deaf),
            mute: Boolean(obj.d?.self_mute), self_deaf: Boolean(obj.d?.self_deaf),
            self_mute: Boolean(obj.d?.self_mute), self_video: false, suppress: false };
          broadcast("VOICE_STATE_UPDATE", voice);
          // Voice RTP/UDP/Voice Gateway is not implemented: no VOICE_SERVER_UPDATE claim.
        }
      } catch { ws.close(4002, "invalid gateway payload"); }
    });
    ws.on("close", () => peers.delete(peer));
  });
  function wsUrl() { const a = server.address() as {port:number}; return `ws://${host === "::1" ? "[::1]" : host}:${a.port}/gateway`; }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address() as {port:number};
  const url = `http://${host === "::1" ? "[::1]" : host}:${address.port}`;
  return {
    server, url, token, adminSecret,
    async close() {
      for (const peer of peers) peer.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
