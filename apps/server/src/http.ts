import type { IncomingMessage, ServerResponse } from "node:http";
import { isRecord } from "./models.js";

export const MAX_PAYLOAD_BYTES = 64 * 1024;

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  path: string;
  url: URL;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);
}

export function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

export function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { message, code: status === 401 ? 0 : 10003 });
}

export function sendText(
  response: ServerResponse,
  contentType: string,
  content: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(content);
}

export class RequestBodyError extends Error {}

export async function readJsonValue(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_PAYLOAD_BYTES) {
      throw new RequestBodyError("Request body exceeds 64KB");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parsed = await readJsonValue(request);
  if (!isRecord(parsed)) throw new RequestBodyError("JSON object required");
  return parsed;
}
