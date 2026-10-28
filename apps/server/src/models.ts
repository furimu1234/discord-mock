import type {
  MockFixture,
  MockSnapshot,
  MockMessageInteraction,
} from "../../../packages/client-js/src/testing-types.js";

export type {
  MockUser,
  MockChannel,
  MockRole,
  MockMember,
  MockPermissionOverwrite,
  MockEmbedField,
  MockEmbed,
  MockAttachment,
  MockAllowedMentions,
  MockMessageReference,
  MockMessageContent,
  MockMessage,
  MockMessageInteraction,
  MockApplicationCommand,
} from "../../../packages/client-js/src/testing-types.js";
export type MockState = MockFixture;
export type LoadedMockState = MockSnapshot;

export interface StoredInteraction {
  token: string;
  response?: Record<string, unknown>;
  channelId?: string;
  command?: MockMessageInteraction;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
