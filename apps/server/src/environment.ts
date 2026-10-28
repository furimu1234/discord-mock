import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { APPLICATION_ID } from "./fixtures.js";
import type { LoadedMockState, MockApplicationCommand, MockMessage, MockMessageContent, MockMessageInteraction, MockUser, StoredInteraction } from "./models.js";
import { type CommandInput, CommandValidationError } from "./commands.js";
import { saveState } from "./persistence.js";
import { requireChannelPermission, SEND_MESSAGES, channelPermissions } from "./permissions.js";
import { ResourceError } from "./resource-validation.js";

interface InteractionOptions {
  actor: MockUser;
  channelId: string;
  commandName: string;
  commandId?: string;
  commandGuildId?: string;
  customId?: string;
  showReplyInTimeline?: boolean;
}

/** Shared domain operations for browser, admin API and Bot REST routes. */
export class MockEnvironment extends EventEmitter<{
  dispatch: [name: string, data: unknown];
  changed: [];
}> {
  readonly interactions = new Map<string, StoredInteraction>();
  private nextId: bigint;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    readonly state: LoadedMockState,
    private readonly dataPath: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
    const seed = BigInt.asUintN(64, BigInt(Date.parse(this.timestamp())) * 4_194_304n);
    this.nextId = seed < 10_000_000_000_000_000n ? 10_000_000_000_000_000n : seed;
  }

  timestamp(): string { return this.now().toISOString(); }

  hasId(id: string): boolean {
    return id === this.state.guild.id || id === this.state.user.id ||
      this.state.users.some((user) => user.id === id) || this.state.guild.roles.some((role) => role.id === id) ||
      this.state.guild.channels.some((channel) => channel.id === id) || this.state.commands.some((command) => command.id === id) ||
      this.interactions.has(id) || Object.values(this.state.messages).some((messages) => messages.some((message) => message.id === id));
  }

  nextSnowflake(): string {
    do {
      this.nextId = this.nextId === (1n << 64n) - 1n ? 10_000_000_000_000_000n : this.nextId + 1n;
    } while (this.hasId(String(this.nextId)));
    return String(this.nextId);
  }

  commit(): Promise<void> {
    this.notifyBrowser();
    const snapshot = structuredClone(this.state);
    this.saving = this.saving.catch(() => {}).then(() => saveState(this.dataPath, snapshot));
    return this.saving;
  }

  flush(): Promise<void> { return this.saving; }

  memberPayload(user: MockUser) {
    return this.state.members.find((member) => member.user.id === user.id) ?? {
      user, roles: [], joined_at: this.timestamp(), deaf: false, mute: false, flags: 0,
    };
  }

  dispatch(name: string, data: unknown): void {
    this.emit("dispatch", name, data);
  }

  notifyBrowser(): void {
    this.emit("changed");
  }

  commandsForScope(guildId?: string): MockApplicationCommand[] {
    return this.state.commands.filter((command) => command.guild_id === guildId);
  }

  availableCommands(): MockApplicationCommand[] {
    const commands = new Map(this.commandsForScope().map((command) => [command.name, command]));
    for (const command of this.commandsForScope(this.state.guild.id)) commands.set(command.name, command);
    return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async registerCommands(inputs: CommandInput[], guildId?: string, replace = true): Promise<MockApplicationCommand[]> {
    const existing = this.commandsForScope(guildId);
    const commands = inputs.map((input): MockApplicationCommand => ({
      ...input,
      id: existing.find((command) => command.name === input.name)?.id ?? this.nextSnowflake(),
      application_id: APPLICATION_ID,
      ...(guildId ? { guild_id: guildId } : {}),
      type: 1,
      options: [],
      version: this.nextSnowflake(),
    }));
    const retained = replace ? [] : existing.filter((old) => !commands.some((command) => command.name === old.name));
    if (retained.length + commands.length > 100) throw new CommandValidationError("At most 100 commands per scope");
    this.state.commands = [
      ...this.state.commands.filter((command) => command.guild_id !== guildId),
      ...retained,
      ...commands,
    ];
    await this.commit();
    return commands;
  }

  async postMessage(channelId: string, body: string | MockMessageContent, author: MockUser, interaction?: MockMessageInteraction): Promise<MockMessage> {
    if (!this.state.guild.channels.some((channel) => channel.id === channelId && channel.type === 0))
      throw new ResourceError("テキストチャンネルが存在しません", 404);
    requireChannelPermission(this.state, author.id, channelId, SEND_MESSAGES);
    const payload: MockMessageContent = typeof body === "string" ? { content: body, embeds: [] } : body;
    const messages = this.state.messages[channelId] ?? [];
    if (payload.enforce_nonce && payload.nonce !== undefined) {
      const duplicated = messages.find((message) =>
        message.author.id === author.id && message.nonce === payload.nonce &&
        Date.parse(this.timestamp()) - Date.parse(message.timestamp) < 300_000);
      if (duplicated) return duplicated;
    }
    const reference = payload.message_reference;
    const referenced = reference?.message_id
      ? (this.state.messages[reference.channel_id ?? channelId] ?? []).find((message) => message.id === reference.message_id)
      : undefined;
    if (reference && !referenced && reference.fail_if_not_exists !== false)
      throw new ResourceError("Unknown referenced message", 404);
    const allowed = payload.allowed_mentions;
    const parsed = allowed?.parse ?? ["users", "roles", "everyone"];
    const userIds = [...payload.content.matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]);
    const roleIds = [...payload.content.matchAll(/<@&(\d{17,20})>/g)].map((match) => match[1]);
    const mentions = [...new Set(userIds)]
      .filter((id) => parsed.includes("users") || allowed?.users?.includes(id))
      .map((id) => this.state.users.find((user) => user.id === id))
      .filter((user): user is MockUser => user !== undefined);
    const mentionRoles = [...new Set(roleIds)].filter((id) =>
      (parsed.includes("roles") || allowed?.roles?.includes(id)) &&
      this.state.guild.roles.some((role) => role.id === id));
    const isForward = reference?.type === 1;
    const message: MockMessage = {
      id: this.nextSnowflake(),
      channel_id: channelId,
      guild_id: this.state.guild.id,
      content: payload.content,
      author,
      timestamp: this.timestamp(),
      edited_timestamp: null,
      tts: payload.tts ?? false,
      mention_everyone: parsed.includes("everyone") &&
        /@(everyone|here)\b/.test(payload.content),
      mentions,
      mention_roles: mentionRoles,
      attachments: payload.attachments ?? [],
      embeds: payload.embeds,
      pinned: false,
      type: reference && !isForward ? 19 : 0,
      flags: payload.flags ?? 0,
      ...(payload.nonce !== undefined ? { nonce: payload.nonce } : {}),
      ...(payload.components !== undefined ? { components: payload.components } : {}),
      ...(payload.sticker_ids?.length ? {
        sticker_items: payload.sticker_ids.map((id) => ({ id, name: "Mock Sticker", format_type: 1 })),
      } : {}),
      ...(payload.poll !== undefined ? { poll: payload.poll } : {}),
      ...(payload.shared_client_theme !== undefined ? { shared_client_theme: payload.shared_client_theme } : {}),
      ...(reference ? {
        message_reference: {
          type: reference.type ?? 0,
          message_id: reference.message_id,
          channel_id: reference.channel_id ?? channelId,
          guild_id: reference.guild_id ?? this.state.guild.id,
        },
        ...(!isForward ? { referenced_message: referenced ?? null } : {}),
        ...(isForward && referenced ? {
          message_snapshots: [{
            message: {
              type: referenced.type, content: referenced.content, embeds: referenced.embeds,
              attachments: referenced.attachments, timestamp: referenced.timestamp,
              edited_timestamp: referenced.edited_timestamp, flags: referenced.flags,
              mentions: referenced.mentions, mention_roles: referenced.mention_roles,
              components: referenced.components ?? [],
            },
          }],
        } : {}),
      } : {}),
      ...(interaction ? {
        application_id: APPLICATION_ID,
        interaction,
        interaction_metadata: {
          id: interaction.id,
          type: 2 as const,
          user: interaction.user,
          authorizing_integration_owners: { "0": this.state.guild.id },
        },
      } : {}),
    };

    this.state.messages[channelId] = messages;
    messages.push(message);
    this.dispatch("MESSAGE_CREATE", {
      ...message,
      guild_id: this.state.guild.id,
      member: this.memberPayload(author),
    });
    await this.commit();
    return message;
  }

  createInteraction(options: InteractionOptions) {
    const { actor, channelId, commandName, commandId, commandGuildId, customId, showReplyInTimeline } = options;
    const id = this.nextSnowflake();
    const token = `mock_interaction_${randomBytes(18).toString("hex")}`;
    const interaction = {
      id,
      application_id: APPLICATION_ID,
      type: customId ? 3 : 2,
      data: customId
        ? { component_type: 2, custom_id: customId }
        : {
          id: commandId ?? this.nextSnowflake(), type: 1, name: commandName, options: [],
          ...(commandGuildId ? { guild_id: commandGuildId } : {}),
        },
      guild_id: this.state.guild.id,
      channel_id: channelId,
      channel: this.state.guild.channels.find((channel) => channel.id === channelId),
      token,
      version: 1,
      member: {
        ...this.memberPayload(actor),
        permissions: String(channelPermissions(this.state, actor.id, channelId)),
      },
      app_permissions: String(channelPermissions(this.state, this.state.user.id, channelId)),
      locale: "ja",
      guild_locale: "ja",
      entitlements: [],
      authorizing_integration_owners: { "0": this.state.guild.id },
      context: 0,
      attachment_size_limit: 8_388_608,
    };

    this.interactions.set(id, {
      token,
      ...(showReplyInTimeline ? { channelId } : {}),
      ...(!customId ? { command: { id, type: 2, name: commandName, user: { ...actor } } } : {}),
    });
    this.dispatch("INTERACTION_CREATE", interaction);
    return interaction;
  }

  guildPayload() {
    return {
      ...this.state.guild,
      members: this.state.members,
      member_count: this.state.members.length,
      large: false,
      unavailable: false,
      presences: [],
      voice_states: [],
      threads: [],
      emojis: [],
      stickers: [],
      features: [],
      afk_timeout: 300,
      verification_level: 0,
      default_message_notifications: 0,
      explicit_content_filter: 0,
      mfa_level: 0,
      nsfw_level: 0,
      premium_tier: 0,
      system_channel_flags: 0,
      preferred_locale: "en-US",
      owner: false,
    };
  }
}
