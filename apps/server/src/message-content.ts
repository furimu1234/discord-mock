import { isRecord, type MockEmbed, type MockEmbedField, type MockMessageContent } from "./models.js";

export class MessageContentError extends Error {}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) {
    throw new MessageContentError(`Embed text must be 1..${limit} characters`);
  }
  return value.trim();
}

function parseField(value: unknown): MockEmbedField {
  if (!isRecord(value) || Object.keys(value).some((key) => !["name", "value", "inline"].includes(key))) {
    throw new MessageContentError("Unsupported embed field");
  }
  if (value.inline !== undefined && typeof value.inline !== "boolean") {
    throw new MessageContentError("Embed field inline must be boolean");
  }
  return {
    name: text(value.name, 256), value: text(value.value, 1024),
    ...(typeof value.inline === "boolean" ? { inline: value.inline } : {}),
  };
}

function parseEmbed(value: unknown): MockEmbed {
  if (!isRecord(value) || Object.keys(value).some((key) => !["type", "title", "description", "color", "fields", "footer"].includes(key))) {
    throw new MessageContentError("Only text embeds with title, description, color, fields and footer are supported");
  }
  if (value.type !== undefined && value.type !== "rich") throw new MessageContentError("Only rich embeds are supported");
  const embed: MockEmbed = { type: "rich" };
  if (value.title !== undefined) embed.title = text(value.title, 256);
  if (value.description !== undefined) embed.description = text(value.description, 4096);
  if (value.color !== undefined) {
    if (typeof value.color !== "number" || !Number.isInteger(value.color) || value.color < 0 || value.color > 0xffffff) {
      throw new MessageContentError("Embed color must be an RGB integer");
    }
    embed.color = value.color;
  }
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length > 25) throw new MessageContentError("At most 25 embed fields are supported");
    embed.fields = value.fields.map(parseField);
  }
  if (value.footer !== undefined) {
    if (!isRecord(value.footer) || Object.keys(value.footer).some((key) => key !== "text")) throw new MessageContentError("Only footer text is supported");
    embed.footer = { text: text(value.footer.text, 2048) };
  }
  if (!embed.title && !embed.description && !embed.fields?.length && !embed.footer) throw new MessageContentError("Embed must contain text");
  return embed;
}

export function parseEmbeds(value: unknown): MockEmbed[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) throw new MessageContentError("At most 10 embeds are supported");
  const embeds = value.map(parseEmbed);
  const length = embeds.reduce((total, embed) => total + (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0), 0);
  if (length > 6000) throw new MessageContentError("Combined embed text exceeds 6000 characters");
  return embeds;
}

export function parseMessageContent(value: unknown): MockMessageContent {
  if (!isRecord(value) || (value.content !== undefined && (typeof value.content !== "string" || value.content.length > 2000))) {
    throw new MessageContentError("Message content must be a string of at most 2000 characters");
  }
  const content = typeof value.content === "string" ? value.content : "";
  const embeds = parseEmbeds(value.embeds);
  if (!content.trim() && !embeds.length) throw new MessageContentError("Message must contain text or an embed");
  return { content, embeds };
}
