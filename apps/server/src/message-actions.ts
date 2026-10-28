import type { LoadedMockState, MockMessage } from "./models.js";
import {
  channelPermissions,
  MANAGE_MESSAGES,
  requireChannelPermission,
  VIEW_CHANNEL,
} from "./permissions.js";
import { ResourceError } from "./resource-validation.js";

export function messageCapabilities(
  state: LoadedMockState,
  userId: string,
  message: Pick<MockMessage, "author" | "channel_id">,
) {
  const permissions = channelPermissions(state, userId, message.channel_id);
  const visible = (permissions & VIEW_CHANNEL) !== 0n;
  const own = message.author.id === userId;
  return {
    canEdit: visible && own,
    canDelete: visible && (own || (permissions & MANAGE_MESSAGES) !== 0n),
  };
}

export function findMessage(
  state: LoadedMockState,
  userId: string,
  channelId: string,
  messageId: string,
): MockMessage {
  requireChannelPermission(state, userId, channelId, VIEW_CHANNEL);
  const message = state.messages[channelId]?.find(
    (item) => item.id === messageId,
  );
  if (!message) throw new ResourceError("メッセージが見つかりません", 404);
  return message;
}

export function editMessage(
  state: LoadedMockState,
  userId: string,
  channelId: string,
  messageId: string,
  content: unknown,
  timestamp: string,
): MockMessage {
  const message = findMessage(state, userId, channelId, messageId);
  if (!messageCapabilities(state, userId, message).canEdit)
    throw new ResourceError("自分が送信したメッセージだけ編集できます", 403);
  if (
    typeof content !== "string" ||
    content.length > 2000 ||
    (!content.trim() && !message.embeds.length && !message.attachments.length)
  )
    throw new ResourceError("メッセージは1～2000文字で入力してください");
  message.content = content;
  message.edited_timestamp = timestamp;
  const userIds = new Set(
    [...content.matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]),
  );
  message.mentions = state.users.filter((user) => userIds.has(user.id));
  const roleIds = new Set(
    [...content.matchAll(/<@&(\d{17,20})>/g)].map((match) => match[1]),
  );
  message.mention_roles = state.guild.roles
    .filter((role) => roleIds.has(role.id))
    .map((role) => role.id);
  message.mention_everyone = /@(everyone|here)\b/.test(content);
  return message;
}

export function deleteMessage(
  state: LoadedMockState,
  userId: string,
  channelId: string,
  messageId: string,
): void {
  const message = findMessage(state, userId, channelId, messageId);
  if (!messageCapabilities(state, userId, message).canDelete)
    throw new ResourceError("メッセージを削除する権限がありません", 403);
  state.messages[channelId] = state.messages[channelId].filter(
    (item) => item.id !== messageId,
  );
}
