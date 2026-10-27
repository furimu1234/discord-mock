export interface MockUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: null;
  bot: boolean;
}

export interface MockChannel {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  position: number;
  permission_overwrites: unknown[];
}

export interface MockMessage {
  id: string;
  channel_id: string;
  content: string;
  author: MockUser;
  timestamp: string;
  edited_timestamp: null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: unknown[];
  mention_roles: string[];
  attachments: unknown[];
  embeds: unknown[];
  pinned: boolean;
  type: number;
  flags: number;
  application_id?: string;
  interaction?: MockMessageInteraction;
  interaction_metadata?: {
    id: string;
    type: 2;
    user: MockUser;
    authorizing_integration_owners: Record<string, string>;
  };
}

export interface MockMessageInteraction {
  id: string;
  type: 2;
  name: string;
  user: MockUser;
}

export interface MockState {
  user: MockUser;
  users?: MockUser[];
  guild: {
    id: string;
    name: string;
    owner_id: string;
    roles: unknown[];
    channels: MockChannel[];
  };
  messages: Record<string, MockMessage[]>;
  commands?: MockApplicationCommand[];
}

// Older JSON files may omit users; loading always supplies dummy users.
export type LoadedMockState = MockState & { users: MockUser[]; commands: MockApplicationCommand[] };

export interface MockApplicationCommand {
  id: string;
  application_id: string;
  guild_id?: string;
  type: 1;
  name: string;
  description: string;
  options: [];
  version: string;
}

export interface StoredInteraction {
  token: string;
  response?: Record<string, unknown>;
  channelId?: string;
  command?: MockMessageInteraction;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
