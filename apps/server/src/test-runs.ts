import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type {
  TestDatabaseSnapshot,
  TestRunStatus,
  TestRunSummary,
  TestRunView,
} from "../../../packages/client-js/src/test-runs.js";
import {
  readJsonBody,
  sendError,
  sendJson,
  type RouteContext,
} from "./http.js";
import type { LoadedMockState, MockState, MockUser } from "./models.js";
import { restoreState } from "./persistence.js";
import { sanitizeTestDatabase } from "./test-database.js";
import {
  ResourceError,
  validateId,
  validateName,
} from "./resource-validation.js";

function publicUser(user: MockUser): MockUser {
  validateId(user.id);
  validateName(user.username);
  if (typeof user.bot !== "boolean")
    throw new ResourceError("表示用ユーザーが不正です");
  return {
    id: user.id,
    username: user.username,
    bot: user.bot,
    discriminator: "0",
    avatar: null,
  };
}

/** 実行中 app の状態と分離した、UT の表示用コピー。Bot へ再配信しない。 */
export class TestRunRoutes {
  private readonly runs = new Map<string, TestRunView>();
  private readonly subscribers = new Set<ServerResponse>();

  private summary(run: TestRunView): TestRunSummary {
    const { id, name, status, step, startedAt, updatedAt } = run;
    return { id, name, status, step, startedAt, updatedAt, hasDatabase: !!run.database };
  }

  databaseFor(id: string): TestDatabaseSnapshot | undefined {
    return this.runs.get(id)?.database;
  }

  async handle({
    request,
    response,
    method,
    path,
  }: RouteContext): Promise<void> {
    if (method === "GET" && path === "/_admin/test-runs/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-content-type-options": "nosniff",
      });
      response.write(": connected\n\n");
      this.subscribers.add(response);
      const timer = setInterval(() => response.write(": ping\n\n"), 25_000);
      response.on("close", () => {
        clearInterval(timer);
        this.subscribers.delete(response);
      });
      return;
    }
    if (method === "GET" && path === "/_admin/test-runs") {
      sendJson(response, 200, {
        runs: [...this.runs.values()].reverse().map((run) => this.summary(run)),
      });
      return;
    }
    const match = path.match(/^\/_admin\/test-runs\/([a-f0-9-]{36})$/);
    const previous = match ? this.runs.get(match[1]) : undefined;
    if (method === "GET" && match) {
      if (previous) sendJson(response, 200, previous);
      else sendError(response, 404, "テスト実行が見つかりません");
      return;
    }
    const creating = method === "POST" && path === "/_admin/test-runs";
    if (!creating && !(method === "PUT" && match)) {
      sendError(response, 405, "未対応のテスト実行操作です");
      return;
    }
    if (!creating && !previous) {
      sendError(response, 404, "テスト実行が見つかりません");
      return;
    }
    if (previous && previous.status !== "running") {
      sendError(response, 409, "完了したテスト実行は更新できません");
      return;
    }
    if (
      request.headers["content-type"]?.split(";", 1)[0].trim() !==
      "application/json"
    ) {
      sendError(response, 415, "JSON content type required");
      return;
    }
    const body = await readJsonBody(request);
    validateName(body.name, 200);
    if (body.step !== undefined) validateName(body.step, 200);
    const status = body.status ?? "running";
    if (
      typeof status !== "string" ||
      !["running", "passed", "failed", "cancelled"].includes(status)
    )
      throw new ResourceError("テスト結果が不正です");
    let state: LoadedMockState;
    try {
      state = restoreState(body.snapshot as MockState);
    } catch {
      throw new ResourceError("表示用スナップショットが不正です");
    }
    const messages: TestRunView["messages"] = {};
    for (const [channelId, entries] of Object.entries(state.messages)) {
      messages[channelId] = entries.map((message) => {
        validateId(message.id);
        if (
          typeof message.content !== "string" ||
          message.content.length > 2000 ||
          !message.author ||
          message.channel_id !== channelId ||
          typeof message.timestamp !== "string" ||
          !Number.isFinite(Date.parse(message.timestamp))
        )
          throw new ResourceError("表示用メッセージが不正です");
        return {
          id: message.id,
          channel_id: channelId,
          content: message.content,
          author: publicUser(message.author),
          timestamp: message.timestamp,
          embeds: message.embeds,
          ...(message.interaction
            ? {
                interaction: {
                  id: message.interaction.id,
                  type: 2 as const,
                  name: message.interaction.name,
                  user: publicUser(message.interaction.user),
                },
              }
            : {}),
        };
      });
    }
    // 大きさは共通の 64KB リクエスト上限、保持数は20件に制限する。
    if (creating && this.runs.size >= 20) {
      const completed = [...this.runs.values()].find(
        (run) => run.status !== "running",
      );
      if (!completed) {
        sendError(response, 429, "同時に表示できるテストは20件までです");
        return;
      }
      this.runs.delete(completed.id);
    }
    const now = new Date().toISOString();
    const step =
      typeof body.step === "string" ? body.step : (previous?.step ?? "開始");
    const steps = previous ? [...previous.steps] : [];
    if (steps.at(-1)?.text !== step) steps.push({ text: step, timestamp: now });
    const run: TestRunView = {
      id: previous?.id ?? randomUUID(),
      name: body.name,
      status: status as TestRunStatus,
      step,
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
      steps: steps.slice(-100),
      guild: {
        name: state.guild.name,
        channels: state.guild.channels.map(({ id, name, type }) => ({
          id,
          name,
          type,
        })),
      },
      messages,
      ...(body.database !== undefined
        ? { database: sanitizeTestDatabase(body.database) }
        : previous?.database ? { database: previous.database } : {}),
    };
    this.runs.set(run.id, run);
    for (const subscriber of this.subscribers)
      subscriber.write("event: changed\ndata: {}\n\n");
    sendJson(response, creating ? 201 : 200, this.summary(run));
  }

  close(): void {
    for (const subscriber of this.subscribers) subscriber.end();
    this.subscribers.clear();
    this.runs.clear();
  }
}
