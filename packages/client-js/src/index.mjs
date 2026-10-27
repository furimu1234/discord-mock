const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function createMockClient({
  baseUrl = "http://127.0.0.1:3000",
  fetchImpl = globalThis.fetch,
} = {}) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || !LOCAL_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("discord-mock must use a local HTTP base URL");
  }
  return {
    async health() {
      const response = await fetchImpl(new URL("/health", parsed));
      if (!response.ok) throw new Error(`Mock health failed: HTTP ${response.status}`);
      return response.json();
    },
  };
}
