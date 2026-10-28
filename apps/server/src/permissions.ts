import type { LoadedMockState } from "./models.js";
import { ResourceError } from "./resource-validation.js";

export const VIEW_CHANNEL = 1n << 10n;
export const SEND_MESSAGES = 1n << 11n;
export const USE_APPLICATION_COMMANDS = 1n << 31n;
export const DEFAULT_PERMISSIONS =
  VIEW_CHANNEL | SEND_MESSAGES | USE_APPLICATION_COMMANDS;
const ADMINISTRATOR = 8n;
const ALL = (1n << 64n) - 1n;

/** 単一 Guild の基本権限と上書きのみ。スレッド・timeout 等は未対応。 */
export function channelPermissions(
  state: LoadedMockState,
  userId: string,
  channelId: string,
): bigint {
  const member = state.members.find((member) => member.user.id === userId);
  const channel = state.guild.channels.find(
    (channel) => channel.id === channelId,
  );
  if (!member || !channel) return 0n;
  // テスト用 Bot と Guild 所有者はこの Mock で管理者として扱う。
  if (userId === state.user.id || userId === state.guild.owner_id) return ALL;
  const roleIds = new Set([state.guild.id, ...member.roles]);
  let permissions = state.guild.roles.reduce(
    (bits, role) =>
      roleIds.has(role.id) ? bits | BigInt(role.permissions) : bits,
    0n,
  );
  if (permissions & ADMINISTRATOR) return ALL;
  const everyone = channel.permission_overwrites.find(
    (entry) => entry.type === 0 && entry.id === state.guild.id,
  );
  if (everyone)
    permissions =
      (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const entry of channel.permission_overwrites) {
    if (
      entry.type !== 0 ||
      entry.id === state.guild.id ||
      !roleIds.has(entry.id)
    )
      continue;
    allow |= BigInt(entry.allow);
    deny |= BigInt(entry.deny);
  }
  permissions = (permissions & ~deny) | allow;
  const user = channel.permission_overwrites.find(
    (entry) => entry.type === 1 && entry.id === userId,
  );
  return user
    ? (permissions & ~BigInt(user.deny)) | BigInt(user.allow)
    : permissions;
}

export function requireChannelPermission(
  state: LoadedMockState,
  userId: string,
  channelId: string,
  permission: bigint,
): void {
  const required = VIEW_CHANNEL | permission;
  if ((channelPermissions(state, userId, channelId) & required) !== required) {
    throw new ResourceError("このチャンネルで操作する権限がありません", 403);
  }
}
