/** Local-only SDK adapter for discord.js and Sapphire. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const CONTROLLER = Symbol("discord-mock");

export interface MockOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface EventClient {
  emit(eventName: string, ...args: unknown[]): unknown;
  login?(token: string): Promise<unknown>;
  rest?: { options: { api: string } };
}

// TypeScript mixins require a constructor accepting arbitrary SDK arguments.
// biome-ignore lint/suspicious/noExplicitAny: TypeScript requires any[] on a generic mixin constructor.
type EventClientConstructor = new (...args: any[]) => EventClient;

function parseLocalUrl(input: string): URL {
  const url = new URL(input);
  const isLocalHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  const hasCredentials = Boolean(url.username || url.password);
  const hasExtraPath = url.pathname !== "/" || Boolean(url.search || url.hash);

  if (!isLocalHttp || hasCredentials || hasExtraPath) {
    throw new Error("Mock URL must use loopback HTTP");
  }
  return url;
}

async function requestHealth(baseUrl: URL, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(new URL("/health", baseUrl), { redirect: "error" });
  if (!response.ok) throw new Error(`Mock health failed: HTTP ${response.status}`);
  return response.json();
}

export class DisMockClient<C extends EventClient> {
  readonly client: C;
  readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(client: C, options: MockOptions = {}) {
    if (!client || typeof client.emit !== "function") {
      throw new TypeError("Expected discord.js/Sapphire client with emit()");
    }
    this.baseUrl = parseLocalUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.client = client;
    this.configureRest();
  }

  configureRest(): boolean {
    const restOptions = this.client.rest?.options;
    if (!restOptions) return false; // Event-only fixtures can be wrapped.

    const api = new URL("/api", this.baseUrl).href.replace(/\/$/, "");
    restOptions.api = api;
    if (restOptions.api !== api) throw new Error("Failed to override SDK REST API base");
    return true;
  }

  async health(): Promise<unknown> {
    return requestHealth(this.baseUrl, this.fetchImpl);
  }

  dispatch(name: string, ...args: unknown[]): unknown {
    if (typeof name !== "string" || !name) throw new TypeError("event must be non-empty");
    return this.client.emit(name, ...args);
  }

  emit(name: string, ...args: unknown[]): unknown {
    return this.dispatch(name, ...args);
  }

  /** Experimental login: REST and Gateway resolve locally; voice is unsupported. */
  async connect(mockToken: string): Promise<unknown> {
    if (!/^mock_[a-zA-Z0-9_-]+$/.test(mockToken)) {
      throw new Error("Only synthetic mock_ tokens are accepted");
    }
    if (!this.configureRest() || !this.client.login) {
      throw new Error("SDK does not expose REST configuration/login");
    }
    return this.client.login(mockToken);
  }
}

export function disMockClient<C extends EventClient>(client: C, options?: MockOptions): DisMockClient<C> {
  return new DisMockClient(client, options);
}

export function disMockMixin<T extends EventClientConstructor>(Base: T, options?: MockOptions) {
  if (typeof Base !== "function" || typeof Base.prototype?.emit !== "function") {
    throw new TypeError("Expected EventEmitter-compatible class");
  }

  return class extends Base {
    declare readonly [CONTROLLER]?: DisMockClient<this>;

    get mock(): DisMockClient<this> {
      const existing = this[CONTROLLER];
      if (existing) return existing;

      const controller = disMockClient(this, options);
      Object.defineProperty(this, CONTROLLER, { value: controller });
      return controller;
    }
  };
}

export const disMockClientClass = disMockMixin;

export function createMockClient(options: MockOptions = {}) {
  const baseUrl = parseLocalUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async health(): Promise<unknown> {
      return requestHealth(baseUrl, fetchImpl);
    },
  };
}
