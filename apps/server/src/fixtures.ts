import type { LoadedMockState, MockUser } from "./models.js";

export const APPLICATION_ID = "123456789000000001";
export const DEFAULT_CHANNEL_ID = "123456789000000002";
export const DEFAULT_USER_ID = "123456789000000099";

export function createUser(id: string, username: string, bot = false): MockUser {
  return { id, username, discriminator: "0", avatar: null, bot };
}

export function createInitialState(): LoadedMockState {
  const guildId = "123456789000000000";

  return {
    user: createUser(APPLICATION_ID, "MockBot", true),
    users: [
      createUser(DEFAULT_USER_ID, "Alice"),
      createUser("123456789000000098", "Bob"),
    ],
    guild: {
      id: guildId,
      name: "Mock Guild",
      owner_id: DEFAULT_USER_ID,
      roles: [{
        id: guildId,
        name: "@everyone",
        color: 0,
        hoist: false,
        position: 0,
        permissions: "0",
        managed: false,
        mentionable: false,
      }],
      channels: [{
        id: DEFAULT_CHANNEL_ID,
        guild_id: guildId,
        name: "general",
        type: 0,
        position: 0,
        permission_overwrites: [],
      }],
    },
    messages: { [DEFAULT_CHANNEL_ID]: [] },
    commands: [],
  };
}
