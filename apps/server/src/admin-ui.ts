import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MockEnvironment } from "./environment.js";
import { readJsonBody, sendError, sendJson, type RouteContext } from "./http.js";
import { MockResources } from "./resources.js";
import { permissionBits, ResourceError, validateId, validateName, validateOverwrites } from "./resource-validation.js";

interface AdminSession { csrf: string; }
const COOKIE = "discord_mock_admin";
const COOKIE_PATH = "/_admin/ui";

export class AdminUiRoutes {
  private readonly sessions = new Map<string, AdminSession>();
  private readonly resources: MockResources;

  constructor(private readonly environment: MockEnvironment, private readonly secret: string) {
    this.resources = new MockResources(environment);
  }

  issueDesktopSession(): string {
    const id = randomBytes(24).toString("hex");
    this.sessions.set(id, { csrf: randomBytes(24).toString("hex") });
    return id;
  }

  private session(request: IncomingMessage): AdminSession | undefined {
    const id = /(?:^|;\s*)discord_mock_admin=([a-f0-9]{48})(?:;|$)/
      .exec(request.headers.cookie ?? "")?.[1];
    return id ? this.sessions.get(id) : undefined;
  }

  private startSession(response: ServerResponse): AdminSession {
    const id = this.issueDesktopSession();
    response.setHeader("set-cookie", `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}`);
    const session = this.sessions.get(id);
    if (!session) throw new Error("管理者セッションの作成に失敗しました");
    return session;
  }

  private view() {
    const { guild, users, members } = this.environment.state;
    return { guild, users, members };
  }

  async handle({ request, response, path, method }: RouteContext): Promise<void> {
    if (path === "/_admin/ui/session" && method === "GET") {
      const session = this.session(request);
      sendJson(response, 200, { authenticated: !!session, csrf: session?.csrf ?? null });
      return;
    }
    if (path === "/_admin/ui/login" && method === "POST") {
      const { secret } = await readJsonBody(request);
      const input = typeof secret === "string" ? Buffer.from(secret) : Buffer.alloc(0);
      const expected = Buffer.from(this.secret);
      if (input.length !== expected.length || !timingSafeEqual(input, expected)) {
        sendError(response, 403, "管理者シークレットが正しくありません");
        return;
      }
      const session = this.startSession(response);
      sendJson(response, 200, { authenticated: true, csrf: session.csrf });
      return;
    }

    const session = this.session(request);
    if (!session) { sendError(response, 401, "管理者としてログインしてください"); return; }
    if (method !== "GET" && request.headers["x-discord-mock-csrf"] !== session.csrf) {
      sendError(response, 403, "Invalid admin CSRF token");
      return;
    }
    if (path === "/_admin/ui/state" && method === "GET") {
      sendJson(response, 200, this.view());
      return;
    }
    if (path === "/_admin/ui/logout" && method === "POST") {
      const id = /(?:^|;\s*)discord_mock_admin=([a-f0-9]{48})(?:;|$)/.exec(request.headers.cookie ?? "")?.[1];
      if (id) this.sessions.delete(id);
      response.setHeader("set-cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=0`);
      sendJson(response, 200, { loggedOut: true });
      return;
    }

    const state = this.environment.state;
    if (method === "POST" && ["/_admin/ui/users", "/_admin/ui/channels", "/_admin/ui/roles"].includes(path)) {
      const body = await readJsonBody(request);
      const id = typeof body.id === "string" && body.id ? body.id : undefined;
      let result: unknown;
      if (path.endsWith("/users")) {
        result = await this.resources.users.create({ id, username: body.username as string });
      } else if (path.endsWith("/channels")) {
        result = await this.resources.channels.create({
          id, name: body.name as string, type: body.type as 0 | 2,
          permissionOverwrites: body.permission_overwrites as never,
        });
      } else {
        result = await this.resources.roles.create({
          id, name: body.name as string, permissions: body.permissions as string, color: body.color as number,
        });
      }
      sendJson(response, 201, result);
      return;
    }

    const guildRoute = path === "/_admin/ui/guild";
    const roleId = /^\/_admin\/ui\/roles\/(\d+)$/.exec(path)?.[1];
    const channelId = /^\/_admin\/ui\/channels\/(\d+)$/.exec(path)?.[1];
    const memberId = /^\/_admin\/ui\/members\/(\d+)$/.exec(path)?.[1];
    const userId = /^\/_admin\/ui\/users\/(\d+)$/.exec(path)?.[1];
    const targetId = roleId ?? channelId ?? memberId ?? userId;
    if (targetId) validateId(targetId);

    if (method === "PATCH") {
      const body = await readJsonBody(request);
      if (guildRoute) {
        validateName(body.name);
        state.guild.name = body.name;
        this.environment.dispatch("GUILD_UPDATE", this.environment.guildPayload());
      } else if (roleId) {
        const role = state.guild.roles.find((item) => item.id === roleId);
        if (!role) throw new ResourceError("ロールが見つかりません", 404);
        if (body.name !== undefined) { validateName(body.name); role.name = body.name; }
        if (body.permissions !== undefined) role.permissions = String(permissionBits(body.permissions));
        if (body.color !== undefined) {
          if (!Number.isInteger(body.color) || (body.color as number) < 0 || (body.color as number) > 0xffffff)
            throw new ResourceError("ロール色が不正です");
          role.color = body.color as number;
        }
        this.environment.dispatch("GUILD_ROLE_UPDATE", { guild_id: state.guild.id, role });
      } else if (channelId) {
        const channel = state.guild.channels.find((item) => item.id === channelId);
        if (!channel) throw new ResourceError("チャンネルが見つかりません", 404);
        if (body.name !== undefined) { validateName(body.name); channel.name = body.name; }
        if (body.permission_overwrites !== undefined) {
          channel.permission_overwrites = validateOverwrites(body.permission_overwrites, state);
        }
        this.environment.dispatch("CHANNEL_UPDATE", channel);
      } else if (memberId) {
        if (!Array.isArray(body.roles) || body.roles.some((id) => typeof id !== "string")) {
          throw new ResourceError("ロール ID の配列を指定してください");
        }
        sendJson(response, 200, await this.resources.setRoles(memberId, body.roles));
        return;
      } else if (userId) {
        const user = state.users.find((item) => item.id === userId);
        if (!user) throw new ResourceError("ユーザーが見つかりません", 404);
        validateName(body.username);
        user.username = body.username;
        this.environment.dispatch("GUILD_MEMBER_UPDATE", { guild_id: state.guild.id, ...state.members.find((member) => member.user.id === userId) });
      } else { sendError(response, 404, "Unknown admin route"); return; }
      await this.environment.commit();
      sendJson(response, 200, this.view());
      return;
    }

    if (method === "DELETE") {
      if (userId) {
        if (userId === state.guild.owner_id) throw new ResourceError("サーバー所有者は削除できません");
        const index = state.users.findIndex((item) => item.id === userId);
        if (index < 0) throw new ResourceError("ユーザーが見つかりません", 404);
        state.users.splice(index, 1);
        state.members = state.members.filter((item) => item.user.id !== userId);
        for (const channel of state.guild.channels) {
          channel.permission_overwrites = channel.permission_overwrites.filter((entry) => !(entry.type === 1 && entry.id === userId));
        }
        this.environment.dispatch("GUILD_MEMBER_REMOVE", { guild_id: state.guild.id, user: { id: userId } });
      } else if (channelId) {
        const index = state.guild.channels.findIndex((item) => item.id === channelId);
        if (index < 0) throw new ResourceError("チャンネルが見つかりません", 404);
        state.guild.channels.splice(index, 1);
        delete state.messages[channelId];
        this.environment.dispatch("CHANNEL_DELETE", { id: channelId, guild_id: state.guild.id });
      } else if (roleId) {
        if (roleId === state.guild.id) throw new ResourceError("@everyone ロールは削除できません");
        const index = state.guild.roles.findIndex((item) => item.id === roleId);
        if (index < 0) throw new ResourceError("ロールが見つかりません", 404);
        state.guild.roles.splice(index, 1);
        for (const member of state.members) member.roles = member.roles.filter((id) => id !== roleId);
        for (const channel of state.guild.channels) {
          channel.permission_overwrites = channel.permission_overwrites.filter((entry) => entry.type !== 0 || entry.id !== roleId);
        }
        this.environment.dispatch("GUILD_ROLE_DELETE", { guild_id: state.guild.id, role_id: roleId });
      } else { sendError(response, 404, "Unknown admin route"); return; }
      await this.environment.commit();
      sendJson(response, 200, { deleted: true });
      return;
    }
    sendError(response, 404, "Unknown admin route");
  }

  close(): void { this.sessions.clear(); }
}
