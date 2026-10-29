export type ApplicationPage = "admin" | "chat";
const CHAT_PATHS = new Set(["/", "/test", "/database", "/tests"]);

/** アプリ内の既知の画面だけを、同じウィンドウの適切なセッションで開く。 */
export function applicationPage(
  destination: string,
  origin: string,
): ApplicationPage | undefined {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return;
  }
  if (url.origin !== origin || url.username || url.password) return;
  if (url.pathname === "/admin") return "admin";
  if (CHAT_PATHS.has(url.pathname)) return "chat";
  return;
}
