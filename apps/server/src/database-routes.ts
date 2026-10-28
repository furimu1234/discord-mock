import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseInspector, DatabaseQuery } from "./database.js";
import { readJsonBody, sendError, sendJson, type RouteContext } from "./http.js";
import { TestRunRoutes } from "./test-runs.js";
import { queryTestDatabase } from "./test-database.js";
import type { TestCaseService } from "./test-cases.js";

interface AdminSession {
  csrf: string;
  expiresAt: number;
}

const SESSION_SECONDS = 3600;
const SESSION_COOKIE = "discord_mock_admin";

function matchesSecret(input: unknown, expected: string): boolean {
  if (typeof input !== "string" || input.length !== expected.length) return false;
  const supplied = Buffer.from(input);
  const secret = Buffer.from(expected);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

function isLocalRequest(request: IncomingMessage): boolean {
  if (!request.headers.host) return false;
  try {
    const origin = new URL(`http://${request.headers.host}`);
    return ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
      !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash &&
      Number(origin.port || 80) === request.socket.localPort &&
      (!request.headers.origin || request.headers.origin === origin.origin) &&
      (!request.headers["sec-fetch-site"] || ["same-origin", "none"].includes(String(request.headers["sec-fetch-site"])));
  } catch { return false; }
}

function parseQuery(url: URL): DatabaseQuery | null {
  const parameters = url.searchParams;
  const schema = parameters.get("schema") ?? "";
  const table = parameters.get("table") ?? "";
  const offsetText = parameters.get("offset") ?? "0";
  const limitText = parameters.get("limit") ?? "50";
  const search = parameters.get("search") ?? "";
  const sort = parameters.get("sort") ?? "";
  const direction = parameters.get("direction") ?? "asc";
  if (
    !schema || !table || schema.length > 128 || table.length > 128 ||
    !/^\d{1,7}$/.test(offsetText) || Number(offsetText) > 1_000_000 ||
    !/^\d{1,3}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 100 ||
    search.length > 200 || sort.length > 128 || !["asc", "desc"].includes(direction)
  ) return null;
  return { schema, table, offset: Number(offsetText), limit: Number(limitText), search, sort, direction: direction === "desc" ? "desc" : "asc" };
}

/** Admin sessions never inherit the selected dummy user's privileges. */
export class DatabaseRoutes {
  private readonly sessions = new Map<string, AdminSession>();
  constructor(private readonly secret: string, private readonly database?: DatabaseInspector, private readonly testCases?: TestCaseService, readonly testRuns = new TestRunRoutes()) {}

  private appDatabase(): DatabaseInspector {
    if (!this.database) throw new Error("App database is unavailable");
    return this.database;
  }

  private session(request: IncomingMessage): AdminSession | undefined {
    const id = /(?:^|;\s*)discord_mock_admin=([a-f0-9]{48})(?:;|$)/.exec(request.headers.cookie ?? "")?.[1];
    if (!id) return;
    const session = this.sessions.get(id);
    if (session && session.expiresAt > Date.now()) return session;
    this.sessions.delete(id);
  }

  private setCookie(response: ServerResponse, id: string, maxAge: number): void {
    response.setHeader("set-cookie", `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/_admin; Max-Age=${maxAge}`);
  }

  async handle({ request, response, method, path, url }: RouteContext): Promise<void> {
    if (!isLocalRequest(request)) {
      sendError(response, 403, "Cross-origin admin access denied");
      return;
    }
    const session = this.session(request);
    if (path === "/_admin/session" && method === "GET") {
      sendJson(response, 200, { authenticated: !!session, databaseAvailable: !!this.database, ...(session ? { csrf: session.csrf } : {}) });
      return;
    }
    if (path === "/_admin/session" && method === "POST") {
      if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") {
        sendError(response, 415, "JSON content type required");
        return;
      }
      const body = await readJsonBody(request);
      const localAccess = body.secret === undefined && request.headers["x-discord-mock-local"] === "1";
      if (!localAccess && !matchesSecret(body.secret, this.secret)) {
        sendError(response, 403, "Invalid admin access key");
        return;
      }
      if (session && localAccess) {
        sendJson(response, 200, { authenticated: true, csrf: session.csrf, databaseAvailable: !!this.database });
        return;
      }
      // Bound the session store and remove expired entries before issuing a cookie.
      for (const [id, value] of this.sessions) if (value.expiresAt <= Date.now()) this.sessions.delete(id);
      if (this.sessions.size >= 100) {
        sendError(response, 429, "Too many admin sessions");
        return;
      }
      const id = randomBytes(24).toString("hex");
      const csrf = randomBytes(24).toString("hex");
      this.sessions.set(id, { csrf, expiresAt: Date.now() + SESSION_SECONDS * 1000 });
      this.setCookie(response, id, SESSION_SECONDS);
      sendJson(response, 200, { authenticated: true, csrf, databaseAvailable: !!this.database });
      return;
    }
    if (path === "/_admin/session" && method === "DELETE") {
      if (!session || request.headers["x-discord-mock-admin-csrf"] !== session.csrf) {
        sendError(response, 403, "Invalid admin session or CSRF token");
        return;
      }
      for (const [id, value] of this.sessions) if (value === session) this.sessions.delete(id);
      this.setCookie(response, "", 0);
      sendJson(response, 200, { authenticated: false });
      return;
    }
    if (!session && !matchesSecret(request.headers["x-discord-mock-secret"], this.secret)) {
      sendError(response, 403, "Admin access required");
      return;
    }
    if (path === "/_admin/test-runs" || path.startsWith("/_admin/test-runs/")) {
      if (method !== "GET" && (!session || request.headers["x-discord-mock-admin-csrf"] !== session.csrf)) {
        sendError(response, 403, "Invalid admin session or CSRF token");
        return;
      }
      await this.testRuns.handle({ request, response, method, path, url });
      return;
    }
    if (path === "/_admin/test-cases" || path === "/_admin/test-cases/run") {
      if (!this.testCases) {
        sendError(response, 503, "テストランナーを使うには pnpm app で起動してください");
        return;
      }
      if (path === "/_admin/test-cases" && method === "GET") {
        sendJson(response, 200, { cases: await this.testCases.list(), ...this.testCases.status() });
        return;
      }
      if (path === "/_admin/test-cases/run" && method === "POST") {
        if (!session || request.headers["x-discord-mock-admin-csrf"] !== session.csrf) {
          sendError(response, 403, "Invalid admin session or CSRF token");
          return;
        }
        if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") {
          sendError(response, 415, "JSON content type required");
          return;
        }
        const body = await readJsonBody(request);
        if (typeof body.id !== "string" || body.id.length > 300) {
          sendError(response, 400, "Invalid test case");
          return;
        }
        try {
          await this.testCases.start(body.id);
          sendJson(response, 202, { started: true });
        } catch (error) {
          sendError(response, 409, error instanceof Error ? error.message : "テストを開始できませんでした");
        }
        return;
      }
      sendError(response, 405, "Unsupported test case operation");
      return;
    }
    if (method !== "GET") {
      sendError(response, 405, "Database inspection is read-only");
      return;
    }
    // A test DB is always an isolated, bounded read-only snapshot. It never changes the app's DB.
    const runId = url.searchParams.get("runId");
    if (runId !== null && !/^[a-f0-9-]{36}$/.test(runId)) {
      sendError(response, 400, "Invalid test run ID");
      return;
    }
    const testDb = runId ? this.testRuns.databaseFor(runId) : undefined;
    if (runId && !testDb) {
      sendError(response, 404, "テストDBの記録がありません。テスト完了後に更新してください");
      return;
    }
    if (!runId && !this.database) {
      sendError(response, 503, "Database inspection is unavailable; start pnpm app");
      return;
    }
    if (path === "/_admin/database/tables") {
      sendJson(response, 200, {
        tables: testDb
          ? testDb.tables.map((table) => ({
              schema: table.schema, name: table.name, columnCount: table.columns.length,
            }))
          : await this.appDatabase().tables(),
      });
      return;
    }
    if (path === "/_admin/database/rows") {
      const query = parseQuery(url);
      if (!query) {
        sendError(response, 400, "Invalid database query");
        return;
      }
      const tables = testDb
        ? testDb.tables.map((table) => ({ schema: table.schema, name: table.name }))
        : await this.appDatabase().tables();
      if (!tables.some((table) => table.schema === query.schema && table.name === query.table)) {
        sendError(response, 404, "Unknown database table");
        return;
      }
      const page = testDb
        ? queryTestDatabase(testDb, query)
        : await this.appDatabase().rows(query);
      if (!page) sendError(response, 404, "Unknown database table or column");
      else sendJson(response, 200, page);
      return;
    }
    sendError(response, 404, "Unknown admin route");
  }

  close(): void {
    this.testRuns.close();
    this.sessions.clear();
  }
}
