import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const previewPath = new URL("../../web/index.html", import.meta.url);
const localHosts = new Set(["127.0.0.1", "::1"]);

export function createMockServer() {
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "GET" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", service: "discord-mock" }));
      return;
    }

    if (pathname === "/" || pathname === "/test" || pathname === "/admin") {
      try {
        const html = await readFile(previewPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "preview_unavailable" }));
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

export async function listenLocal({ host = "127.0.0.1", port = 3000 } = {}) {
  if (!localHosts.has(host)) {
    throw new Error("Remote bind is disabled: use 127.0.0.1 or ::1 with SSH forwarding/VPN.");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("port must be an integer from 0 to 65535");
  }
  const server = createMockServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  return { server, url: `http://${host === "::1" ? "[::1]" : host}:${actualPort}` };
}
