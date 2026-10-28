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

export interface StartupClient extends EventClient {
  login(token?: string): Promise<unknown>;
  destroy(): unknown;
  rawListeners(event: string): unknown[];
  removeListener(event: string, listener: StartupListener): unknown;
  on(event: string, listener: StartupListener): unknown;
  once(event: string, listener: StartupListener): unknown;
}

type StartupListener = ((...args: unknown[]) => unknown) & {
  listener?: (...args: unknown[]) => unknown;
};

const STARTING_CLIENTS = new WeakSet<EventClient>();

/** Node EventEmitter の公開 API で Ready の非同期初期化を追跡する。 */
function trackReady(
  client: StartupClient,
  pending: Promise<unknown>[],
): { ready: Promise<void>; restore(): void } {
  const originals = client.rawListeners("clientReady").map((callback) => {
    if (typeof callback !== "function")
      throw new TypeError("Expected an event listener");
    return callback as StartupListener;
  });
  for (const original of [...originals].reverse())
    client.removeListener("clientReady", original);
  const tracked = originals.map((raw) => {
    const original = raw.listener ?? raw;
    const once = Boolean(raw.listener);
    let fired = false;
    const listener: StartupListener = function (this: unknown, ...args) {
      if (once) {
        if (fired) return;
        fired = true;
        client.removeListener("clientReady", listener);
      }
      const result = original.apply(this, args);
      const completion = Promise.resolve(result);
      pending.push(completion);
      void completion.catch(() => {});
      return result;
    };
    // removeListener(event, 元の関数) も通常の EventEmitter と同様に機能させる。
    listener.listener = original;
    client.on("clientReady", listener);
    return { once, original, listener };
  });
  let readyListener: StartupListener;
  const ready = new Promise<void>((resolve) => {
    readyListener = () => resolve();
    client.once("clientReady", readyListener);
  });
  return {
    ready,
    restore() {
      client.removeListener("clientReady", readyListener);
      const current = client.rawListeners("clientReady") as StartupListener[];
      // 起動中に追加されたリスナーの位置も保って、残存する関数だけを復元する。
      for (const listener of [...current].reverse())
        client.removeListener("clientReady", listener);
      for (const listener of current) {
        const entry = tracked.find((entry) => entry.listener === listener);
        if (!entry) client.on("clientReady", listener);
        else if (entry.once) client.once("clientReady", entry.original);
        else client.on("clientReady", entry.original);
      }
    },
  };
}

/** 既存の起動関数内の login() を、同じ Client のローカル接続へ一時的に差し替える。 */
export function Client<C extends StartupClient, R>(
  client: C,
  main: (client: C, connect: () => Promise<unknown>) => R | Promise<R>,
  options: MockOptions = {},
): (mockToken: string) => Promise<R> {
  if (
    !client ||
    typeof client.login !== "function" ||
    typeof client.destroy !== "function"
  )
    throw new TypeError("Expected an SDK Client with login() and destroy()");
  if (typeof main !== "function")
    throw new TypeError("Expected a Bot startup function");
  // 呼出側が後で書き換えた options で接続先を変えない。
  const baseUrl = parseLocalUrl(options.baseUrl ?? DEFAULT_BASE_URL).origin;

  return async (mockToken) => {
    if (
      typeof mockToken !== "string" ||
      !/^mock_[a-zA-Z0-9_-]+$/.test(mockToken)
    )
      throw new Error("Only synthetic mock_ tokens are accepted");
    if (STARTING_CLIENTS.has(client))
      throw new Error("この Client の起動処理はすでに実行中です");
    STARTING_CLIENTS.add(client);
    const descriptor = Object.getOwnPropertyDescriptor(client, "login");
    const login = client.login;
    let connection: Promise<unknown> | undefined;
    const pending: Promise<unknown>[] = [];
    let restoreReady = () => {};
    let ready: Promise<void> | undefined;
    const connect = () => {
      connection ??= Promise.resolve().then(() => {
        const adapter = disMockClient(client, { baseUrl });
        if (!adapter.configureRest())
          throw new Error("SDK does not expose REST configuration/login");
        const tracking = trackReady(client, pending);
        restoreReady = tracking.restore;
        ready = tracking.ready;
        // main が保持している TOKEN は使わず、引数のダミートークンだけを渡す。
        return login.call(client, mockToken);
      });
      // main が login() を await しない場合も、下の await まで拒否を処理しておく。
      void connection.catch(() => {});
      return connection;
    };
    try {
      // main が login 前に REST を使用する場合もローカルへ向ける。
      if (!disMockClient(client, { baseUrl }).configureRest())
        throw new Error("SDK does not expose REST configuration/login");
      Object.defineProperty(client, "login", {
        configurable: true,
        writable: true,
        value: connect,
      });
      const result = await main(client, connect);
      if (!connection)
        throw new Error(
          "起動関数から client.login() または connect() を呼んでください",
        );
      await connection;
      // SDK の login が Ready の dispatch より先に解決する場合も待つ。
      await ready;
      await Promise.all(pending);
      return result;
    } catch (error) {
      await Promise.resolve()
        .then(() => client.destroy())
        .catch(() => {});
      throw error;
    } finally {
      restoreReady();
      if (descriptor) Object.defineProperty(client, "login", descriptor);
      else Reflect.deleteProperty(client, "login");
      STARTING_CLIENTS.delete(client);
    }
  };
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
