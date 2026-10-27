/** Local-only SDK adapter for discord.js and Sapphire. */
const HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export interface MockOptions { baseUrl?: string; fetchImpl?: typeof fetch }
export interface EventClient {
  emit(eventName: string, ...args: any[]): unknown;
  login?(token: string): Promise<unknown>;
  rest?: { options: { api: string } };
}
function localUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" || !HOSTS.has(url.hostname) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("Mock URL must use loopback HTTP");
  return url;
}
export class DisMockClient<C extends EventClient> {
  readonly client: C;
  readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  constructor(client: C, options: MockOptions = {}) {
    if (!client || typeof client.emit !== "function") throw new TypeError("Expected discord.js/Sapphire client with emit()");
    this.baseUrl = localUrl(options.baseUrl ?? "http://127.0.0.1:3000");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.client = client;
    this.configureRest();
  }
  configureRest(): boolean {
    if (!this.client.rest?.options) return false; // Event-only fixtures can be wrapped.
    const api = new URL("/api", this.baseUrl).href.replace(/\/$/, "");
    this.client.rest.options.api = api;
    if (this.client.rest.options.api !== api) throw new Error("Failed to override SDK REST API base");
    return true;
  }
  async health(): Promise<unknown> {
    const response = await this.fetchImpl(new URL("/health", this.baseUrl), { redirect: "error" });
    if (!response.ok) throw new Error(`Mock health failed: HTTP ${response.status}`);
    return response.json();
  }
  dispatch(name: string, ...args: any[]): unknown {
    if (typeof name !== "string" || !name) throw new TypeError("event must be non-empty");
    return this.client.emit(name, ...args);
  }
  emit(name: string, ...args: any[]): unknown { return this.dispatch(name, ...args); }
  /** Experimental login: REST and Gateway always resolve locally; voice is unsupported. */
  async connect(mockToken: string): Promise<unknown> {
    if (!/^mock_[a-zA-Z0-9_-]+$/.test(mockToken)) throw new Error("Only synthetic mock_ tokens are accepted");
    if (!this.configureRest() || !this.client.login) throw new Error("SDK does not expose REST configuration/login");
    return this.client.login(mockToken);
  }
}
export function disMockClient<C extends EventClient>(client: C, options?: MockOptions): DisMockClient<C> {
  return new DisMockClient(client, options);
}
const CONTROLLER = Symbol("discord-mock");
export function disMockMixin<T extends new (...args: any[]) => EventClient>(Base: T, options?: MockOptions) {
  if (typeof Base !== "function" || typeof Base.prototype?.emit !== "function") throw new TypeError("Expected EventEmitter-compatible class");
  return class extends Base {
    get mock(): DisMockClient<this> {
      if (!(CONTROLLER in this)) Object.defineProperty(this, CONTROLLER, { value: disMockClient(this, options) });
      return (this as any)[CONTROLLER];
    }
  };
}
export const disMockClientClass = disMockMixin;
export function createMockClient(options: MockOptions = {}) {
  const baseUrl = localUrl(options.baseUrl ?? "http://127.0.0.1:3000");
  const f = options.fetchImpl ?? globalThis.fetch;
  return { async health(): Promise<unknown> {
    const res = await f(new URL("/health", baseUrl), { redirect: "error" });
    if (!res.ok) throw new Error(`Mock health failed: HTTP ${res.status}`);
    return res.json();
  } };
}
