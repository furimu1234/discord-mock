const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DISMOCK_CONTROLLER = Symbol("discord-mock-controller");

export function createMockClient({
  baseUrl = "http://127.0.0.1:3000",
  fetchImpl = globalThis.fetch,
} = {}) {
  const parsed = new URL(baseUrl);
  if (
    parsed.protocol !== "http:" ||
    !LOCAL_HOSTS.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("discord-mock must use a local HTTP base URL");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  return {
    async health() {
      // Never follow a redirect from the local Mock to a remote endpoint.
      const response = await fetchImpl(new URL("/health", parsed), { redirect: "error" });
      if (!response.ok) throw new Error(`Mock health failed: HTTP ${response.status}`);
      return response.json();
    },
  };
}

/**
 * Attach a test controller to an existing discord.js/Sapphire client instance.
 *
 * The original instance is preserved. emit() is a public SDK event hook; this
 * does NOT establish a mock Gateway, create native Discord model objects, or
 * intercept the client's REST/Voice/login methods.
 */
export class DisMockClient {
  constructor(client, options = {}) {
    if (client === null || typeof client !== "object" || typeof client.emit !== "function") {
      throw new TypeError("disMockClient requires a discord.js/Sapphire-style client with emit()");
    }
    this.client = client;
    this.transport = createMockClient(options);
  }

  health() {
    return this.transport.health();
  }

  dispatch(eventName, ...args) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("eventName must be a non-empty string");
    }
    return this.client.emit(eventName, ...args);
  }

  emit(eventName, ...args) {
    return this.dispatch(eventName, ...args);
  }
}

export function disMockClient(client, options) {
  return new DisMockClient(client, options);
}

/**
 * An SDK-agnostic subclass factory. Compatible with Client, SapphireClient
 * and any user subclass. It never replaces the superclass constructor or
 * rewrites SDK internals.
 *
 * Usage: class UtBot extends disMockMixin(MyBot) {}
 */
export function disMockMixin(BaseClass, options = {}) {
  if (typeof BaseClass !== "function" || typeof BaseClass.prototype?.emit !== "function") {
    throw new TypeError("disMockMixin expects a client class whose instances provide emit()");
  }
  return class DisMockEnabled extends BaseClass {
    get mock() {
      if (this[DISMOCK_CONTROLLER] === undefined) {
        Object.defineProperty(this, DISMOCK_CONTROLLER, {
          configurable: false,
          value: new DisMockClient(this, options),
        });
      }
      return this[DISMOCK_CONTROLLER];
    }
  };
}

export const disMockClientClass = disMockMixin;
