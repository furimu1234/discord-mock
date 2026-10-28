import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserState, SessionResponse } from "../../web/src/types.js";
import type { MockEnvironment } from "./environment.js";
import type { TestCaseService } from "./test-cases.js";
import { readJsonBody, sendError, sendJson, type RouteContext } from "./http.js";
import { channelPermissions, requireChannelPermission, USE_APPLICATION_COMMANDS, VIEW_CHANNEL } from "./permissions.js";
import { MockResources } from "./resources.js";
import { findMessage, messageCapabilities } from "./message-actions.js";
import { ResourceError, validateId } from "./resource-validation.js";
import type { TestRunRoutes } from "./test-runs.js";

interface BrowserSession {
  selectedUserId: string;
  csrf: string;
}

/** Browser identity is independent of the admin API's secret. */
export class BrowserRoutes {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly subscribers = new Set<ServerResponse>();

  constructor(
    private readonly environment: MockEnvironment,
    private readonly botConnectionCount: () => number,
    private readonly testCases?: TestCaseService,
    private readonly testRuns?: TestRunRoutes,
  ) {
    environment.on("changed", this.notifySubscribers);
  }

  private readonly notifySubscribers = (): void => {
    for (const subscriber of this.subscribers) {
      subscriber.write("event: changed\ndata: {}\n\n");
    }
  };

  private getSession(request: IncomingMessage): BrowserSession | undefined {
    const sessionId = /(?:^|;\s*)discord_mock_session=([a-f0-9]{48})(?:;|$)/
      .exec(request.headers.cookie ?? "")?.[1];
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  private openSession(request: IncomingMessage, response: ServerResponse): void {
    let session = this.getSession(request);
    if (!session) {
      const sessionId = randomBytes(24).toString("hex");
      session = {
        selectedUserId: this.environment.state.users[0].id,
        csrf: randomBytes(24).toString("hex"),
      };
      this.sessions.set(sessionId, session);
      response.setHeader(
        "set-cookie",
        `discord_mock_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/_ui`,
      );
    }

    const result: SessionResponse = {
      csrf: session.csrf,
      selectedUserId: session.selectedUserId,
      users: this.environment.state.users,
      members: this.environment.state.members,
      roles: this.environment.state.guild.roles,
    };
    sendJson(response, 200, result);
  }

  private view(session: BrowserSession): BrowserState {
    const { guild, users, messages } = this.environment.state;
    const channels = guild.channels.filter((channel) => (channelPermissions(this.environment.state, session.selectedUserId, channel.id) & VIEW_CHANNEL) !== 0n);
    return {
      guild: { ...guild, channels },
      users,
      messages: Object.fromEntries(channels.map((channel) => [channel.id, (messages[channel.id] ?? []).map((message) => ({
        ...message, ...messageCapabilities(this.environment.state, session.selectedUserId, message),
      }))])),
      commands: this.environment.availableCommands(),
      selectedUserId: session.selectedUserId,
      botConnections: this.botConnectionCount(),
    };
  }

  private subscribe(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    });
    response.write(": connected\n\n");
    this.subscribers.add(response);
    const keepAlive = setInterval(() => response.write(": ping\n\n"), 25_000);
    request.once("close", () => {
      clearInterval(keepAlive);
      this.subscribers.delete(response);
    });
  }

  async handle({ request, response, method, path, url }: RouteContext): Promise<void> {
    if (method === "GET" && path === "/_ui/session") {
      this.openSession(request, response);
      return;
    }

    const session = this.getSession(request);
    if (!session) {
      sendError(response, 401, "Open /test to start a local browser session");
      return;
    }
    if (method === "GET" && path === "/_ui/state") {
      sendJson(response, 200, this.view(session));
      return;
    }
    if (method === "GET" && path === "/_ui/events") {
      this.subscribe(request, response);
      return;
    }
    const runPath = path.match(/^\/_ui\/test-runs\/([a-f0-9-]{36})$/);
    if (method === "GET" && runPath && this.testRuns) {
      sendJson(response, 200, this.testRuns.browserView(runPath[1], session.selectedUserId));
      return;
    }
    const messagePath = path.match(/^\/_ui\/messages\/([^/]+)\/([^/]+)$/);
    if (messagePath && ["GET", "PATCH", "DELETE"].includes(method)) {
      const [, channelId, messageId] = messagePath;
      validateId(channelId);
      validateId(messageId);
      const runId = url.searchParams.get("runId");
      if (runId !== null && !/^[a-f0-9-]{36}$/.test(runId)) throw new ResourceError("テスト実行IDが不正です");
      if (runId !== null && !this.testRuns) throw new ResourceError("テスト実行が見つかりません", 404);
      if (method !== "GET" && request.headers["x-discord-mock-csrf"] !== session.csrf) {
        sendError(response, 403, "Invalid browser CSRF token");
        return;
      }
      const read = () => {
        if (runId && this.testRuns) return this.testRuns.browserMessage(runId, session.selectedUserId, channelId, messageId);
        const message = findMessage(this.environment.state, session.selectedUserId, channelId, messageId);
        return { ...message, ...messageCapabilities(this.environment.state, session.selectedUserId, message) };
      };
      if (method === "GET") { sendJson(response, 200, read()); return; }
      const body = method === "PATCH" ? await readJsonBody(request) : {};
      if (runId && this.testRuns) this.testRuns.changeMessage(runId, session.selectedUserId, channelId, messageId, method as "PATCH" | "DELETE", body.content);
      else if (method === "PATCH") await this.environment.editMessage(session.selectedUserId, channelId, messageId, body.content);
      else await this.environment.deleteMessage(session.selectedUserId, channelId, messageId);
      sendJson(response, 200, method === "PATCH" ? read() : { deleted: true });
      return;
    }
    if (method !== "POST") {
      sendError(response, 405, "Method not allowed");
      return;
    }
    if (request.headers["x-discord-mock-csrf"] !== session.csrf) {
      sendError(response, 403, "Invalid browser CSRF token");
      return;
    }

    const body = await readJsonBody(request);
    const { state } = this.environment;

    if (path === "/_ui/test-cases/run") {
      if (!this.testCases) {
        sendError(response, 503, "テストランナーを使用できません");
        return;
      }
      if (typeof body.id !== "string" || body.id.length > 300) {
        sendError(response, 400, "Invalid test case ID");
        return;
      }
      // 送信側が指定した user_id は使わず、Cookie にひも付いたログイン状態のみ採用する。
      try {
        await this.testCases.start(body.id, session.selectedUserId);
        sendJson(response, 202, { started: true });
      } catch (error) {
        sendError(response, 409, error instanceof Error ? error.message : "テストを開始できませんでした");
      }
      return;
    }

    if (path === "/_ui/channels") {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) {
        sendError(response, 400, "チャンネル名は1～100文字で指定してください");
        return;
      }
      const resources = new MockResources(this.environment);
      if (state.guild.channels.some((channel) => channel.name === body.name && channel.type === 0)) {
        sendError(response, 409, "同名のテキストチャンネルが存在します");
        return;
      }
      const channel = await resources.channels.create({ name: body.name, type: 0 });
      sendJson(response, 201, channel);
      return;
    }

    if (path === "/_ui/identity") {
      const user = state.users.find((user) => user.id === body.user_id);
      if (!user) {
        sendError(response, 400, "Unknown dummy user");
        return;
      }
      session.selectedUserId = user.id;
      sendJson(response, 200, { selectedUserId: user.id });
      return;
    }

    if (path === "/_ui/messages") {
      const channel = state.guild.channels.find((channel) => channel.id === body.channel_id && channel.type === 0);
      if (
        !channel ||
        typeof body.content !== "string" ||
        !body.content.trim() ||
        body.content.length > 2000
      ) {
        sendError(response, 400, "Invalid channel or message");
        return;
      }
      const actor = state.users.find((user) => user.id === session.selectedUserId);
      if (!actor) throw new Error("Browser session has no dummy user");
      const message = await this.environment.postMessage(channel.id, body.content, actor);
      sendJson(response, 201, message);
      return;
    }

    if (path === "/_ui/interaction") {
      const channel = state.guild.channels.find((channel) => channel.id === body.channel_id && channel.type === 0);
      if (!channel) {
        sendError(response, 400, "Invalid command or channel");
        return;
      }
      const command = this.environment.availableCommands().find((command) =>
        body.command_id !== undefined ? command.id === body.command_id : command.name === body.name,
      );
      if (!command) {
        sendError(response, 404, "Unknown registered command");
        return;
      }
      const actor = state.users.find((user) => user.id === session.selectedUserId);
      if (!actor) throw new Error("Browser session has no dummy user");
      requireChannelPermission(state, actor.id, channel.id, USE_APPLICATION_COMMANDS);
      const interaction = this.environment.createInteraction({
        actor,
        channelId: channel.id,
        commandName: command.name,
        commandId: command.id,
        commandGuildId: command.guild_id,
        showReplyInTimeline: true,
      });
      sendJson(response, 201, { id: interaction.id });
      return;
    }

    sendError(response, 404, "Unknown browser route");
  }

  close(): void {
    this.environment.off("changed", this.notifySubscribers);
    for (const subscriber of this.subscribers) subscriber.end();
    this.subscribers.clear();
    this.sessions.clear();
  }
}
