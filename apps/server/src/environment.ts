import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { APPLICATION_ID } from "./fixtures.js";
import type { LoadedMockState, MockApplicationCommand, MockMessage, MockMessageInteraction, MockUser, StoredInteraction } from "./models.js";
import { type CommandInput, CommandValidationError } from "./commands.js";
import { saveState } from "./persistence.js";

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
  private nextId = BigInt(Date.now()) * 4_194_304n;

  constructor(
    readonly state: LoadedMockState,
    private readonly dataPath: string | null,
  ) {
    super();
  }

  private nextSnowflake(): string {
    return String(++this.nextId);
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
    this.notifyBrowser();
    await saveState(this.dataPath, this.state);
    return commands;
  }

  async postMessage(channelId: string, content: string, author: MockUser, interaction?: MockMessageInteraction): Promise<MockMessage> {
    const message: MockMessage = {
      id: this.nextSnowflake(),
      channel_id: channelId,
      content,
      author,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
      flags: 0,
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

    const messages = this.state.messages[channelId] ?? [];
    this.state.messages[channelId] = messages;
    messages.push(message);
    this.dispatch("MESSAGE_CREATE", {
      ...message,
      guild_id: this.state.guild.id,
      member: {
        roles: [],
        joined_at: new Date().toISOString(),
        flags: 0,
        user: author,
      },
    });
    this.notifyBrowser();
    await saveState(this.dataPath, this.state);
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
        user: actor,
        roles: [],
        permissions: "0",
        joined_at: new Date().toISOString(),
        flags: 0,
      },
      app_permissions: "0",
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
      members: [{
        user: this.state.user,
        roles: [],
        joined_at: new Date().toISOString(),
        deaf: false,
        mute: false,
        flags: 0,
      }],
      member_count: 1,
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
