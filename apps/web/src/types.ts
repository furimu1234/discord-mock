import type { MockEmbed } from "../../server/src/models.js";

/** JSON returned by the local browser API, limited to fields used by the UI. */
export interface BrowserUser {
  id: string;
  username: string;
  bot: boolean;
}

export interface BrowserChannel {
  id: string;
  name: string;
  type: number;
}

export interface BrowserMessage {
  id: string;
  channel_id: string;
  author: BrowserUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  canEdit?: boolean;
  canDelete?: boolean;
  embeds?: MockEmbed[];
  interaction?: {
    id: string;
    type: number;
    name: string;
    user: BrowserUser;
  };
}

export interface BrowserCommand {
  id: string;
  name: string;
  description: string;
}

export interface IdentityResponse {
  selectedUserId: string;
}

export interface SessionResponse extends IdentityResponse {
  csrf: string;
  users: BrowserUser[];
  members?: Array<{ user: BrowserUser; roles: string[] }>;
  roles?: Array<{ id: string; name: string; color: number }>;
}

export interface BrowserState extends IdentityResponse {
  guild: {
    name: string;
    channels: BrowserChannel[];
  };
  users: BrowserUser[];
  messages: Record<string, BrowserMessage[]>;
  botConnections: number;
  commands: BrowserCommand[];
}
