import {
  isRecord,
  type MockAllowedMentions,
  type MockAttachment,
  type MockEmbed,
  type MockEmbedField,
  type MockMessageContent,
  type MockMessageReference,
} from "./models.js";

export class MessageContentError extends Error {}

const SNOWFLAKE = /^\d{17,20}$/;
const CREATE_FIELDS = new Set([
  "content", "nonce", "enforce_nonce", "tts", "embeds", "allowed_mentions",
  "message_reference", "components", "sticker_ids", "attachments", "flags",
  "poll", "shared_client_theme",
]);

function string(value: unknown, maximum: number, name: string, required = false): string {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim()))
    throw new MessageContentError(`${name} must be a string of at most ${maximum} characters`);
  return value;
}
function id(value: unknown, name: string): string {
  if (typeof value !== "string" || !SNOWFLAKE.test(value))
    throw new MessageContentError(`Invalid ${name}`);
  return value;
}
function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new MessageContentError(`${name} must be an object`);
  return value;
}
function objectArray(value: unknown, max: number, name: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > max || !value.every(isRecord))
    throw new MessageContentError(`${name} must contain at most ${max} objects`);
  return value;
}
function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new MessageContentError(`${name} must be boolean`);
  return value;
}
function optionalText(
  value: Record<string, unknown>, key: string, maximum: number, name: string, required = false,
): string | undefined {
  return value[key] === undefined ? undefined : string(value[key], maximum, name, required);
}
function media(value: unknown, name: string): MockEmbed["image"] {
  const data = record(value, name);
  const url = string(data.url, 2048, `${name}.url`, true);
  const result: NonNullable<MockEmbed["image"]> = { url };
  for (const key of ["proxy_url"] as const) {
    if (data[key] !== undefined) result[key] = string(data[key], 2048, `${name}.${key}`);
  }
  for (const key of ["width", "height"] as const) {
    if (data[key] !== undefined) {
      if (!Number.isSafeInteger(data[key]) || Number(data[key]) < 0)
        throw new MessageContentError(`${name}.${key} must be nonnegative integer`);
      result[key] = Number(data[key]);
    }
  }
  return result;
}
function parseField(value: unknown): MockEmbedField {
  const field = record(value, "embed.fields");
  const result: MockEmbedField = {
    name: string(field.name, 256, "embed.fields.name", true),
    value: string(field.value, 1024, "embed.fields.value", true),
  };
  if (field.inline !== undefined) result.inline = bool(field.inline, "embed.fields.inline");
  return result;
}
function parseEmbed(value: unknown): MockEmbed {
  const data = record(value, "embed");
  if (data.type !== undefined && data.type !== "rich")
    throw new MessageContentError("Only rich embeds can be created");
  const result: MockEmbed = { type: "rich" };
  result.title = optionalText(data, "title", 256, "embed.title");
  result.description = optionalText(data, "description", 4096, "embed.description");
  result.url = optionalText(data, "url", 2048, "embed.url");
  result.timestamp = optionalText(data, "timestamp", 128, "embed.timestamp");
  if (result.timestamp && !Number.isFinite(Date.parse(result.timestamp)))
    throw new MessageContentError("Invalid embed timestamp");
  if (data.color !== undefined) {
    if (!Number.isInteger(data.color) || Number(data.color) < 0 || Number(data.color) > 0xffffff)
      throw new MessageContentError("Embed color must be an RGB integer");
    result.color = Number(data.color);
  }
  if (data.fields !== undefined) {
    if (!Array.isArray(data.fields) || data.fields.length > 25)
      throw new MessageContentError("At most 25 embed fields are supported");
    result.fields = data.fields.map(parseField);
  }
  if (data.footer !== undefined) {
    const footer = record(data.footer, "embed.footer");
    result.footer = { text: string(footer.text, 2048, "embed.footer.text", true) };
    for (const key of ["icon_url", "proxy_icon_url"] as const)
      if (footer[key] !== undefined) result.footer[key] = string(footer[key], 2048, `embed.footer.${key}`);
  }
  if (data.author !== undefined) {
    const author = record(data.author, "embed.author");
    result.author = { name: string(author.name, 256, "embed.author.name", true) };
    for (const key of ["url", "icon_url", "proxy_icon_url"] as const)
      if (author[key] !== undefined) result.author[key] = string(author[key], 2048, `embed.author.${key}`);
  }
  if (data.thumbnail !== undefined) result.thumbnail = media(data.thumbnail, "embed.thumbnail");
  if (data.image !== undefined) result.image = media(data.image, "embed.image");
  // These fields are server-produced but may occur in saved or imported Message payloads.
  if (data.video !== undefined) {
    const video = record(data.video, "embed.video");
    result.video = { ...video } as MockEmbed["video"];
  }
  if (data.provider !== undefined) {
    const provider = record(data.provider, "embed.provider");
    result.provider = { ...provider } as MockEmbed["provider"];
  }
  return result;
}
export function parseEmbeds(value: unknown): MockEmbed[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) throw new MessageContentError("At most 10 embeds are supported");
  const embeds = value.map(parseEmbed);
  const length = embeds.reduce((total, embed) => total +
    (embed.title?.length ?? 0) + (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) + (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0), 0);
  if (length > 6000) throw new MessageContentError("Combined embed text exceeds 6000 characters");
  return embeds;
}
function parseAllowedMentions(value: unknown): MockAllowedMentions {
  const data = record(value, "allowed_mentions");
  const result: MockAllowedMentions = {};
  if (data.parse !== undefined) {
    if (!Array.isArray(data.parse) || data.parse.length > 3 ||
      !data.parse.every((entry) => ["everyone", "roles", "users"].includes(entry)))
      throw new MessageContentError("Invalid allowed_mentions.parse");
    result.parse = data.parse;
  }
  for (const key of ["users", "roles"] as const) {
    if (data[key] !== undefined) {
      if (!Array.isArray(data[key]) || data[key].length > 100)
        throw new MessageContentError(`Invalid allowed_mentions.${key}`);
      result[key] = data[key].map((item: unknown) => id(item, `allowed_mentions.${key}`));
    }
  }
  if (data.replied_user !== undefined) result.replied_user = bool(data.replied_user, "allowed_mentions.replied_user");
  return result;
}
function parseReference(value: unknown): MockMessageReference {
  const data = record(value, "message_reference");
  const result: MockMessageReference = {};
  if (data.type !== undefined) {
    if (data.type !== 0 && data.type !== 1) throw new MessageContentError("Unsupported message reference type");
    result.type = data.type;
  }
  for (const key of ["message_id", "channel_id", "guild_id"] as const)
    if (data[key] !== undefined) result[key] = id(data[key], `message_reference.${key}`);
  if (data.fail_if_not_exists !== undefined)
    result.fail_if_not_exists = bool(data.fail_if_not_exists, "message_reference.fail_if_not_exists");
  if (!result.message_id) throw new MessageContentError("message_reference.message_id is required");
  return result;
}
function parseAttachments(value: unknown): MockAttachment[] {
  const raw = objectArray(value, 10, "attachments");
  return raw.map((attachment) => {
    const result: MockAttachment = {
      id: string(attachment.id, 25, "attachment.id", true),
      filename: string(attachment.filename, 256, "attachment.filename", true),
    };
    for (const key of ["description", "title", "content_type", "url", "proxy_url", "waveform"] as const)
      if (attachment[key] !== undefined)
        result[key] = string(attachment[key], 2048, `attachment.${key}`);
    for (const key of ["size", "flags", "width", "height", "duration_secs"] as const) {
      const value = attachment[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new MessageContentError(`Invalid attachment.${key}`);
      result[key] = value;
    }
    if (attachment.ephemeral !== undefined) result.ephemeral = bool(attachment.ephemeral, "attachment.ephemeral");
    return result;
  });
}
export function parseMessageContent(value: unknown): MockMessageContent {
  const data = record(value, "message");
  for (const key of Object.keys(data))
    if (!CREATE_FIELDS.has(key)) throw new MessageContentError(`Unknown Create Message field: ${key}`);
  const content = data.content === undefined ? "" : string(data.content, 2000, "content");
  const embeds = parseEmbeds(data.embeds);
  const result: MockMessageContent = { content, embeds };
  if (data.nonce !== undefined) {
    if ((typeof data.nonce !== "string" && !Number.isSafeInteger(data.nonce)) ||
        String(data.nonce).length > 25)
      throw new MessageContentError("nonce must be an integer or string of at most 25 characters");
    result.nonce = data.nonce as string | number;
  }
  if (data.enforce_nonce !== undefined) result.enforce_nonce = bool(data.enforce_nonce, "enforce_nonce");
  if (data.tts !== undefined) result.tts = bool(data.tts, "tts");
  if (data.allowed_mentions !== undefined) result.allowed_mentions = parseAllowedMentions(data.allowed_mentions);
  if (data.message_reference !== undefined) result.message_reference = parseReference(data.message_reference);
  if (data.components !== undefined) result.components = objectArray(data.components, 40, "components");
  if (data.sticker_ids !== undefined) {
    if (!Array.isArray(data.sticker_ids) || data.sticker_ids.length > 3)
      throw new MessageContentError("At most 3 stickers are supported");
    result.sticker_ids = data.sticker_ids.map((item: unknown) => id(item, "sticker_ids"));
  }
  if (data.attachments !== undefined) result.attachments = parseAttachments(data.attachments);
  if (data.flags !== undefined) {
    const allowed = 4 | 4096 | 8192 | 32768;
    if (!Number.isSafeInteger(data.flags) || Number(data.flags) < 0 || (Number(data.flags) & ~allowed) !== 0)
      throw new MessageContentError("Unsupported Create Message flags");
    result.flags = Number(data.flags);
  }
  if (data.poll !== undefined) result.poll = record(data.poll, "poll");
  if (data.shared_client_theme !== undefined)
    result.shared_client_theme = record(data.shared_client_theme, "shared_client_theme");
  const isForward = result.message_reference?.type === 1;
  if (result.flags !== undefined && (result.flags & 32768) !== 0 &&
    (content || embeds.length || result.sticker_ids?.length || result.poll || result.shared_client_theme))
    throw new MessageContentError("IS_COMPONENTS_V2 messages cannot contain content, embeds, stickers, poll or theme");
  if (!isForward && !content.trim() && !embeds.length && !result.components?.length &&
      !result.sticker_ids?.length && !result.attachments?.length && !result.poll && !result.shared_client_theme)
    throw new MessageContentError("Message must contain content, embeds, components, stickers, attachments, poll or theme");
  return result;
}
