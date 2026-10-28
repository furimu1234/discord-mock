import type {
  CreateChannelInput,
  CreateRoleInput,
  CreateUserInput,
  ResourceCollection,
} from "../../../packages/client-js/src/testing-types.js";
import type { MockEnvironment } from "./environment.js";
import { createUser } from "./fixtures.js";
import type { MockChannel, MockMember, MockRole, MockUser } from "./models.js";
import {
  ResourceError,
  permissionBits,
  validateId,
  validateName,
  validateOverwrites,
} from "./resource-validation.js";

function collection<T extends { id: string }, Input>(
  values: () => T[],
  name: (item: T) => string,
  create: (input: Input) => Promise<T>,
): ResourceCollection<T, Input> {
  return {
    create,
    get(id) {
      validateId(id);
      return structuredClone(values().find((item) => item.id === id));
    },
    list() {
      return structuredClone(values());
    },
    findByName(value) {
      validateName(value);
      const found = values().filter((item) => name(item) === value);
      if (found.length > 1)
        throw new ResourceError(
          "同名のリソースが複数あります。ID を指定してください",
        );
      return structuredClone(found[0]);
    },
  };
}

/** UI・Gateway・JSON と同じ環境を更新するリソース操作。 */
export class MockResources {
  readonly users: ResourceCollection<MockUser, CreateUserInput>;
  readonly channels: ResourceCollection<MockChannel, CreateChannelInput>;
  readonly roles: ResourceCollection<MockRole, CreateRoleInput>;

  constructor(private readonly environment: MockEnvironment) {
    this.users = collection(
      () => environment.state.users,
      (user) => user.username,
      (input) => this.createUser(input),
    );
    this.channels = collection(
      () => environment.state.guild.channels,
      (channel) => channel.name,
      (input) => this.createChannel(input),
    );
    this.roles = collection(
      () => environment.state.guild.roles,
      (role) => role.name,
      (input) => this.createRole(input),
    );
  }

  private id(input: string | undefined): string {
    const id = input ?? this.environment.nextSnowflake();
    validateId(id);
    if (this.environment.hasId(id))
      throw new ResourceError("リソース ID が重複しています");
    return id;
  }

  private async createUser(input: CreateUserInput): Promise<MockUser> {
    validateName(input.username);
    const user = createUser(this.id(input.id), input.username);
    const member: MockMember = {
      user,
      roles: [],
      joined_at: this.environment.timestamp(),
      deaf: false,
      mute: false,
      flags: 0,
    };
    this.environment.state.users.push(user);
    this.environment.state.members.push(member);
    this.environment.dispatch("GUILD_MEMBER_ADD", {
      guild_id: this.environment.state.guild.id,
      ...member,
    });
    await this.environment.commit();
    return structuredClone(user);
  }

  private async createChannel(input: CreateChannelInput): Promise<MockChannel> {
    validateName(input.name);
    const type = input.type ?? 0;
    if (type !== 0 && type !== 2)
      throw new ResourceError(
        "チャンネルはテキスト (0) または VC (2) を指定してください",
      );
    const permissionOverwrites = validateOverwrites(
      input.permissionOverwrites ?? [],
      this.environment.state,
    );
    const channel: MockChannel = {
      id: this.id(input.id),
      guild_id: this.environment.state.guild.id,
      name: input.name,
      type,
      position: this.environment.state.guild.channels.length,
      permission_overwrites: permissionOverwrites,
    };
    this.environment.state.guild.channels.push(channel);
    if (type === 0) this.environment.state.messages[channel.id] = [];
    this.environment.dispatch("CHANNEL_CREATE", channel);
    await this.environment.commit();
    return structuredClone(channel);
  }

  private async createRole(input: CreateRoleInput): Promise<MockRole> {
    validateName(input.name);
    const permissions = String(permissionBits(input.permissions ?? "0"));
    const color = input.color ?? 0;
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
      throw new ResourceError("ロールの色が範囲外です");
    const role: MockRole = {
      id: this.id(input.id),
      name: input.name,
      permissions,
      color,
      position: this.environment.state.guild.roles.length,
      hoist: false,
      managed: false,
      mentionable: false,
    };
    this.environment.state.guild.roles.push(role);
    this.environment.dispatch("GUILD_ROLE_CREATE", {
      guild_id: this.environment.state.guild.id,
      role,
    });
    await this.environment.commit();
    return structuredClone(role);
  }

  async setRoles(userId: string, roleIds: string[]): Promise<MockMember> {
    validateId(userId);
    if (!Array.isArray(roleIds))
      throw new ResourceError("ロール ID の配列を指定してください");
    const member = this.environment.state.members.find(
      (member) => member.user.id === userId,
    );
    if (!member) throw new ResourceError("メンバーが存在しません", 404);
    if (
      new Set(roleIds).size !== roleIds.length ||
      roleIds.some(
        (id) =>
          id === this.environment.state.guild.id ||
          !this.environment.state.guild.roles.some((role) => role.id === id),
      )
    )
      throw new ResourceError("所属ロールが存在しないか重複しています");
    member.roles = [...roleIds];
    this.environment.dispatch("GUILD_MEMBER_UPDATE", {
      guild_id: this.environment.state.guild.id,
      ...member,
    });
    await this.environment.commit();
    return structuredClone(member);
  }
}
