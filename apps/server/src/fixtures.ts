import type { LoadedMockState, MockUser } from "./models.js";

import { DEFAULT_PERMISSIONS } from "./permissions.js";

export const APPLICATION_ID = "123456789000000001";
export const DEFAULT_CHANNEL_ID = "123456789000000002";
export const DEFAULT_USER_ID = "123456789000000099";

export function createUser(id: string, username: string, bot = false): MockUser {
  return { id, username, discriminator: "0", avatar: null, bot };
}

export function createInitialState(): LoadedMockState {
  const guildId = "123456789000000000";

  const bot = createUser(APPLICATION_ID, "MockBot", true);
  const users = [
    createUser(DEFAULT_USER_ID, "Alice"),
    createUser("123456789000000098", "Bob"),
    createUser("123456789000000097", "Charlie"),
    createUser("123456789000000096", "Diana"),
    createUser("123456789000000095", "Eve"),
    createUser("123456789000000094", "Frank"),
    createUser("123456789000000093", "Grace"),
    createUser("123456789000000092", "Heidi"),
    createUser("123456789000000091", "Ivan"),
    createUser("123456789000000090", "Judy"),
  ];
  return {
    version: 1,
    members: [bot, ...users].map((user) => ({
      user,
      roles: user.id === DEFAULT_USER_ID ? ["123456789000000010"] : user.username === "Bob" ? ["123456789000000011"] : [],
      joined_at: "2026-01-01T00:00:00.000Z",
      deaf: false, mute: false, flags: 0,
    })),
    user: bot,
    users,
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
        permissions: String(DEFAULT_PERMISSIONS),
        managed: false,
        mentionable: false,
      }, {
        id: "123456789000000010",
        name: "Moderator",
        color: 5793266,
        hoist: false,
        position: 1,
        permissions: "0",
        managed: false,
        mentionable: true,
      }, {
        id: "123456789000000011",
        name: "Tester",
        color: 7506394,
        hoist: false,
        position: 2,
        permissions: "0",
        managed: false,
        mentionable: true,
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
