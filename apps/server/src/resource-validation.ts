import type { LoadedMockState, MockPermissionOverwrite } from "./models.js";
import { isRecord } from "./models.js";
import { APPLICATION_ID } from "./fixtures.js";

export class ResourceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function validateId(id: unknown): asserts id is string {
  if (
    typeof id !== "string" ||
    !/^[1-9]\d{16,19}$/.test(id) ||
    BigInt(id) > (1n << 64n) - 1n
  ) {
    throw new ResourceError(
      "ID は 17〜20 桁の符号なし 64bit 整数の文字列にしてください",
    );
  }
}
export function validateName(
  value: unknown,
  max = 100,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  ) {
    throw new ResourceError(
      `名前は空白だけを除く 1〜${max} 文字にしてください`,
    );
  }
}
export function permissionBits(value: unknown): bigint {
  if (
    (typeof value !== "string" || !/^\d{1,20}$/.test(value)) &&
    typeof value !== "bigint"
  ) {
    throw new ResourceError(
      "権限は 64bit 整数の文字列または bigint にしてください",
    );
  }
  const bits = BigInt(value);
  if (bits < 0n || bits > (1n << 64n) - 1n)
    throw new ResourceError("権限が範囲外です");
  return bits;
}
export function validateOverwrites(
  input: unknown,
  state: LoadedMockState,
): MockPermissionOverwrite[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new ResourceError("チャンネルの権限設定が不正です");
  const seen = new Set<string>();
  return input.map((entry: unknown) => {
    if (!isRecord(entry) || (entry.type !== 0 && entry.type !== 1))
      throw new ResourceError("権限の対象が不正です");
    validateId(entry.id);
    const exists =
      entry.type === 0
        ? state.guild.roles.some((role) => role.id === entry.id)
        : [state.user, ...state.users].some((user) => user.id === entry.id);
    if (!exists || seen.has(entry.id))
      throw new ResourceError("権限の対象が存在しないか重複しています");
    seen.add(entry.id);
    return {
      id: entry.id,
      type: entry.type,
      allow: String(permissionBits(entry.allow)),
      deny: String(permissionBits(entry.deny)),
    };
  });
}

/** JSON フィクスチャもコードからの作成と同じ参照整合性を守る。 */
export function validateResources(state: LoadedMockState): void {
  const { guild, users, user: bot, members } = state;
  validateId(guild.id);
  validateName(guild.name);
  const ids = new Set([guild.id]);
  const unique = (id: unknown) => {
    validateId(id);
    if (ids.has(id)) throw new ResourceError("リソース ID が重複しています");
    ids.add(id);
  };
  for (const user of [bot, ...users]) {
    unique(user.id);
    validateName(user.username);
    if (
      typeof user.bot !== "boolean" ||
      user.avatar !== null ||
      typeof user.discriminator !== "string"
    ) {
      throw new ResourceError("ユーザーが不正です");
    }
  }
  if (
    users.some((user) => user.bot) ||
    !bot.bot ||
    bot.id !== APPLICATION_ID ||
    !users.some((user) => user.id === guild.owner_id)
  ) {
    throw new ResourceError("Bot または Guild 所有者が不正です");
  }
  if (
    !Array.isArray(guild.roles) ||
    guild.roles.filter((role) => role.id === guild.id).length !== 1
  ) {
    throw new ResourceError("@everyone ロールが必要です");
  }
  for (const role of guild.roles) {
    if (role.id !== guild.id) unique(role.id);
    validateName(role.name);
    permissionBits(role.permissions);
    if (
      !Number.isInteger(role.color) ||
      role.color < 0 ||
      role.color > 0xffffff ||
      !Number.isInteger(role.position) ||
      role.position < 0 ||
      [role.hoist, role.managed, role.mentionable].some(
        (flag) => typeof flag !== "boolean",
      )
    )
      throw new ResourceError("ロールが不正です");
  }
  for (const channel of guild.channels) {
    unique(channel.id);
    validateName(channel.name);
    if (
      channel.guild_id !== guild.id ||
      ![0, 2].includes(channel.type) ||
      !Number.isInteger(channel.position) ||
      channel.position < 0
    )
      throw new ResourceError("チャンネルが不正です");
    channel.permission_overwrites = validateOverwrites(
      channel.permission_overwrites,
      state,
    );
  }
  const memberIds = new Set<string>();
  for (const member of members) {
    const canonical = [bot, ...users].find(
      (user) => user.id === member.user?.id,
    );
    if (
      !canonical ||
      memberIds.has(canonical.id) ||
      !Array.isArray(member.roles) ||
      new Set(member.roles).size !== member.roles.length ||
      member.roles.some(
        (id) => id === guild.id || !guild.roles.some((role) => role.id === id),
      ) ||
      typeof member.joined_at !== "string" ||
      !Number.isFinite(Date.parse(member.joined_at)) ||
      typeof member.deaf !== "boolean" ||
      typeof member.mute !== "boolean" ||
      !Number.isInteger(member.flags) ||
      member.flags < 0
    ) {
      throw new ResourceError("メンバーまたは所属ロールが不正です");
    }
    member.user = canonical;
    memberIds.add(canonical.id);
  }
  if (memberIds.size !== users.length + 1)
    throw new ResourceError("全ユーザーの Guild メンバー情報が必要です");
  for (const channelId of Object.keys(state.messages)) {
    if (
      !guild.channels.some(
        (channel) => channel.id === channelId && channel.type === 0,
      )
    )
      throw new ResourceError("メッセージのチャンネルが存在しません");
  }
}
