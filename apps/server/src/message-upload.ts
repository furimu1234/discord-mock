import type { IncomingMessage } from "node:http";
import type { MockEnvironment } from "./environment.js";
import { readJsonBody, RequestBodyError } from "./http.js";
import { parseMessageContent, MessageContentError } from "./message-content.js";
import { isRecord, type MockMessageContent } from "./models.js";

const MAX_MULTIPART_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;

function localUrl(request: IncomingMessage): string {
  const address = request.socket.localAddress;
  const host = address === "::1" ? "[::1]" : "127.0.0.1";
  return `http://${host}:${request.socket.localPort}`;
}

/**
 * Parse the public Create Message JSON form and multipart payload_json + files[n].
 * Uploads remain local to the running mock; no real Discord CDN requests occur.
 */
export async function readCreateMessage(
  request: IncomingMessage,
  environment: MockEnvironment,
): Promise<MockMessageContent> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return parseMessageContent(await readJsonBody(request));
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_MULTIPART_BYTES) throw new RequestBodyError("Multipart body exceeds 25 MiB");
    chunks.push(bytes);
  }
  const req = new Request("http://localhost/mock-upload", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(Buffer.concat(chunks)),
  });
  let data: FormData;
  try {
    data = await req.formData();
  } catch {
    throw new MessageContentError("Invalid multipart/form-data body");
  }
  const rawPayload = data.get("payload_json");
  let payload: Record<string, unknown> = {};
  if (rawPayload !== null) {
    if (typeof rawPayload !== "string") throw new MessageContentError("payload_json must be a JSON object");
    let parsed: unknown;
    try { parsed = JSON.parse(rawPayload); }
    catch { throw new MessageContentError("payload_json must be valid JSON"); }
    if (!isRecord(parsed)) throw new MessageContentError("payload_json must contain an object");
    payload = parsed;
  } else {
    const content = data.get("content");
    if (typeof content === "string") payload.content = content;
  }

  const uploaded: Array<{ index: string; file: File }> = [];
  const seen = new Set<string>();
  data.forEach((value, name) => {
    if (name === "payload_json" || name === "content") return;
    const match = /^files\[(\d+)\]$/.exec(name);
    if (!match || typeof value === "string") throw new MessageContentError("Unknown or invalid multipart field");
    const index = match[1];
    if (seen.has(index) || Number(index) >= MAX_FILES)
      throw new MessageContentError("Duplicate or invalid files[n] index");
    seen.add(index);
    uploaded.push({ index, file: value });
  });
  if (uploaded.length > MAX_FILES) throw new MessageContentError("At most 10 uploaded files are supported");
  if (uploaded.length === 0) return parseMessageContent(payload);

  const metadata = payload.attachments === undefined ? [] : payload.attachments;
  if (!Array.isArray(metadata) || !metadata.every(isRecord))
    throw new MessageContentError("attachments must be an array of objects");
  const expected = new Set(uploaded.map((item) => item.index));
  if (metadata.some((item) => !expected.has(String(item.id))))
    throw new MessageContentError("attachments contains unknown file ids");

  const entries = uploaded.map(({ index, file }) => {
    if (!file.name || file.name.length > 256) throw new MessageContentError("Invalid uploaded filename");
    const supplied = metadata.find((item) => String(item.id) === index);
    return {
      index,
      file,
      description: supplied?.description,
      filename: typeof supplied?.filename === "string" ? supplied.filename : file.name,
    };
  });
  // Validate all JSON fields before saving any uploaded bytes.
  const body = parseMessageContent({
    ...payload,
    attachments: entries.map((item) => ({
      id: item.index,
      filename: item.filename,
      ...(item.description !== undefined ? { description: item.description } : {}),
    })),
  });

  body.attachments = [];
  for (const item of entries) {
    const bytes = Buffer.from(await item.file.arrayBuffer());
    const contentType = item.file.type || "application/octet-stream";
    const id = environment.storeUpload(bytes, contentType);
    const url = `${localUrl(request)}/api/v10/mock-attachments/${id}`;
    body.attachments.push({
      id,
      filename: item.filename,
      ...(item.description !== undefined ? { description: String(item.description) } : {}),
      content_type: contentType,
      size: bytes.length,
      url,
      proxy_url: url,
    });
  }
  return body;
}
