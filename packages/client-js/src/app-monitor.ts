/** DB 未使用で Pool の error が発火しない場合も、app の停止を検知する。 */
export function monitorApp(
  baseUrl: string,
  onDisconnect: () => void,
): () => void {
  const endpoint = new URL("/health", baseUrl);
  let closed = false;
  let active: AbortController | undefined;
  const timer = setInterval(() => {
    void check();
  }, 1000);

  function stop(): void {
    closed = true;
    clearInterval(timer);
    active?.abort();
  }

  async function check(): Promise<void> {
    if (closed || active) return;
    active = new AbortController();
    try {
      const response = await fetch(endpoint, {
        redirect: "error",
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(1500)]),
      });
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("service" in body) ||
        body.service !== "discord-mock" ||
        !("status" in body) ||
        body.status !== "ok"
      )
        throw new Error();
    } catch {
      if (!closed) {
        stop();
        onDisconnect();
      }
    } finally {
      active = undefined;
    }
  }

  return stop;
}
