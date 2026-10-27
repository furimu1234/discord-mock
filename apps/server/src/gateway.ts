import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { MockEnvironment } from "./environment.js";
import { APPLICATION_ID } from "./fixtures.js";
import { isAllowedOrigin, MAX_PAYLOAD_BYTES } from "./http.js";
import { isRecord } from "./models.js";

interface GatewayPeer {
  socket: WebSocket;
  sequence: number;
  identified: boolean;
  sessionId: string;
}

export class MockGateway {
  private readonly peers = new Set<GatewayPeer>();
  private readonly sockets = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  constructor(
    server: Server,
    private readonly environment: MockEnvironment,
    private readonly token: string,
    private readonly gatewayUrl: () => string,
  ) {
    environment.on("dispatch", this.broadcast);
    server.on("upgrade", (request, socket, head) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path !== "/gateway" || !isAllowedOrigin(request.headers.origin)) {
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (websocket) => {
        this.sockets.emit("connection", websocket, request);
      });
    });
    this.sockets.on("connection", (socket) => this.connect(socket));
  }

  get connectionCount(): number {
    return [...this.peers].filter((peer) => peer.identified).length;
  }

  private dispatch(peer: GatewayPeer, name: string, data: unknown): void {
    peer.socket.send(JSON.stringify({ op: 0, t: name, s: ++peer.sequence, d: data }));
  }

  private readonly broadcast = (name: string, data: unknown): void => {
    for (const peer of this.peers) {
      if (!peer.identified || peer.socket.readyState !== WebSocket.OPEN) continue;
      this.dispatch(peer, name, data);
    }
  };

  private connect(socket: WebSocket): void {
    const peer: GatewayPeer = {
      socket,
      sequence: 0,
      identified: false,
      sessionId: randomBytes(12).toString("hex"),
    };
    this.peers.add(peer);
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 }, s: null, t: null }));
    socket.on("message", (raw: RawData) => this.receive(peer, raw));
    socket.on("close", () => {
      this.peers.delete(peer);
      this.environment.notifyBrowser();
    });
  }

  private identify(peer: GatewayPeer, token: unknown): void {
    if (token !== this.token) {
      peer.socket.close(4004, "invalid mock token");
      return;
    }

    peer.identified = true;
    this.environment.notifyBrowser();
    this.dispatch(peer, "READY", {
      v: 10,
      user: this.environment.state.user,
      guilds: [{ id: this.environment.state.guild.id, unavailable: true }],
      session_id: peer.sessionId,
      resume_gateway_url: this.gatewayUrl(),
      application: { id: APPLICATION_ID, flags: 0 },
      private_channels: [],
      shard: [0, 1],
      _trace: [],
    });
    this.dispatch(peer, "GUILD_CREATE", this.environment.guildPayload());
  }

  private receive(peer: GatewayPeer, raw: RawData): void {
    try {
      const packet: unknown = JSON.parse(raw.toString());
      if (!isRecord(packet)) throw new Error("Gateway object required");
      const data = isRecord(packet.d) ? packet.d : {};

      switch (packet.op) {
        case 1:
          peer.socket.send(JSON.stringify({ op: 11, d: null, s: null, t: null }));
          return;
        case 2:
          this.identify(peer, data.token);
          return;
        case 6:
          if (data.session_id === peer.sessionId) {
            peer.identified = true;
            this.dispatch(peer, "RESUMED", { _trace: [] });
          }
          return;
        case 4:
          if (!peer.identified) return;
          this.environment.dispatch("VOICE_STATE_UPDATE", {
            guild_id: data.guild_id,
            channel_id: data.channel_id ?? null,
            user_id: this.environment.state.user.id,
            session_id: peer.sessionId,
            deaf: Boolean(data.self_deaf),
            mute: Boolean(data.self_mute),
            self_deaf: Boolean(data.self_deaf),
            self_mute: Boolean(data.self_mute),
            self_video: false,
            suppress: false,
          });
          // Voice RTP/UDP/Voice Gateway is not implemented; no VOICE_SERVER_UPDATE.
      }
    } catch {
      peer.socket.close(4002, "invalid gateway payload");
    }
  }

  async close(): Promise<void> {
    this.environment.off("dispatch", this.broadcast);
    for (const peer of this.peers) peer.socket.terminate();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
  }
}
