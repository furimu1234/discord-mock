import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { renderBrowserScript, renderPage } from "../../web/src/page.js";
import { handleAdminRoute } from "./admin.js";
import { BrowserRoutes } from "./browser.js";
import { MockEnvironment } from "./environment.js";
import { MockGateway } from "./gateway.js";
import { isAllowedOrigin, RequestBodyError, sendError, sendJson, sendText } from "./http.js";
import { loadState, restoreState } from "./persistence.js";
import { handleRestRoute } from "./rest.js";
import { isMockToken, loadOrCreateToken } from "./tokens.js";
import { DatabaseRoutes } from "./database-routes.js";
import type { DatabaseInspector } from "./database.js";
import type { TestCaseService } from "./test-cases.js";
import { MessageContentError } from "./message-content.js";
import type { MockState } from "./models.js";
import { MockTesting, validateTimeout } from "./testing.js";
import { ResourceError } from "./resource-validation.js";

export type { MockChannel, MockMessage, MockState, MockUser } from "./models.js";

export interface ServerOptions {
  host?: string;
  port?: number;
  statePath?: string;
  token?: string;
  tokenPath?: string;
  database?: DatabaseInspector;
  testCases?: TestCaseService;
  initialState?: MockState;
  now?: () => Date;
  timeoutMs?: number;
}

export interface MockRuntime {
  server: Server;
  url: string;
  token: string;
  adminSecret: string;
  testing: MockTesting;
  close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const PAGE_PATHS = new Set(["/", "/test", "/admin", "/database", "/tests"]);
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function validateOptions(host: string, port: number, token: string | undefined): void {
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("Only loopback listeners are allowed");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("port must be 0..65535");
  }
  if (token !== undefined && !isMockToken(token)) {
    throw new Error("Only synthetic mock_ tokens are allowed");
  }
}

function listeningUrl(server: Server, host: string): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock server is not listening on TCP");
  const hostname = host === "::1" ? "[::1]" : host;
  return `http://${hostname}:${address.port}`;
}

export async function startMock(options: ServerOptions = {}): Promise<MockRuntime> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  validateOptions(host, port, options.token);
  validateTimeout(options.timeoutMs ?? 3000);
  if (options.initialState && options.statePath) throw new Error("initialState と statePath は同時指定できません");
  if (options.token !== undefined && options.tokenPath !== undefined) {
    throw new Error("Specify either token or tokenPath, not both");
  }

  const token = options.tokenPath
    ? await loadOrCreateToken(resolve(options.tokenPath))
    : options.token ?? `mock_${randomBytes(20).toString("hex")}`;
  const adminSecret = randomBytes(20).toString("hex");
  const dataPath = options.statePath ? resolve(options.statePath) : null;
  const state = options.initialState ? restoreState(options.initialState) : await loadState(dataPath);
  const environment = new MockEnvironment(state, dataPath, options.now);

  const server = createServer(async (request, response) => {
    // Do not allow a different website to read or mutate the local mock.
    if (!isAllowedOrigin(request.headers.origin)) {
      sendError(response, 403, "Cross-origin access denied");
      return;
    }

    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/api\/v\d+/, "");
    const isApi = (request.url ?? "").startsWith("/api/");
    const context = { request, response, method, path, url };

    try {
      if (method === "GET" && path === "/health") {
        sendJson(response, 200, { status: "ok", service: "discord-mock" });
      } else if (method === "GET" && PAGE_PATHS.has(path) && !isApi) {
        sendText(response, "text/html; charset=utf-8", renderPage(), {
          "content-security-policy": CONTENT_SECURITY_POLICY,
        });
      } else if (method === "GET" && path === "/_ui/client.js") {
        sendText(response, "text/javascript; charset=utf-8", renderBrowserScript());
      } else if (path.startsWith("/_ui/")) {
        await browser.handle(context);
      } else if (path.startsWith("/_mock/")) {
        await handleAdminRoute(context, environment, adminSecret);
      } else if (path.startsWith("/_admin/")) {
        await database.handle(context);
      } else if (isApi) {
        await handleRestRoute(context, environment, token, gatewayUrl());
      } else {
        sendError(response, 404, "Unknown mock route");
      }
    } catch (error) {
      if (error instanceof ResourceError) {
        sendError(response, error.status, error.message);
        return;
      }
      if (error instanceof MessageContentError) {
        sendJson(response, 400, { message: error.message, code: 50035 });
        return;
      }
      const invalidBody = error instanceof SyntaxError || error instanceof RequestBodyError;
      sendError(response, invalidBody ? 400 : 500, "Mock request failed");
    }
  });

  const gatewayUrl = () => `${listeningUrl(server, host).replace("http:", "ws:")}/gateway`;
  const gateway = new MockGateway(server, environment, token, gatewayUrl);
  const browser = new BrowserRoutes(environment, () => gateway.connectionCount);
  const database = new DatabaseRoutes(adminSecret, options.database, options.testCases);
  const testing = new MockTesting(environment, () => gateway.connectionCount, options.timeoutMs);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  let closing: Promise<void> | undefined;
  return {
    server,
    url: listeningUrl(server, host),
    token,
    adminSecret,
    testing,
    close() {
      closing ??= (async () => {
        testing.close();
        browser.close();
        database.close();
        await gateway.close();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        await environment.flush();
      })();
      return closing;
    },
  };
}
