import type { EventClient } from "./index.js";
import type { TestRunProgress, TestRunTarget } from "./test-runs.js";

export interface MockUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: null;
  bot: boolean;
}
export interface MockPermissionOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}
export interface MockChannel {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  position: number;
  permission_overwrites: MockPermissionOverwrite[];
}
export interface MockRole {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
}
export interface MockMember {
  user: MockUser;
  roles: string[];
  joined_at: string;
  deaf: boolean;
  mute: boolean;
  flags: number;
}
/** Discord API v10 Embed structure. Read-only/server-produced media fields are optional. */
export interface MockEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}
export interface MockEmbed {
  type: "rich";
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string; proxy_icon_url?: string };
  image?: { url: string; proxy_url?: string; height?: number; width?: number };
  thumbnail?: { url: string; proxy_url?: string; height?: number; width?: number };
  video?: { url?: string; proxy_url?: string; height?: number; width?: number };
  provider?: { name?: string; url?: string };
  author?: { name: string; url?: string; icon_url?: string; proxy_icon_url?: string };
  fields?: MockEmbedField[];
}
export interface MockMessageReference {
  type?: number;
  message_id?: string;
  channel_id?: string;
  guild_id?: string;
  fail_if_not_exists?: boolean;
}
export interface MockAllowedMentions {
  parse?: Array<"roles" | "users" | "everyone">;
  roles?: string[];
  users?: string[];
  replied_user?: boolean;
}
export interface MockAttachment {
  id: string;
  filename: string;
  description?: string;
  title?: string;
  content_type?: string;
  size?: number;
  url?: string;
  proxy_url?: string;
  height?: number | null;
  width?: number | null;
  ephemeral?: boolean;
  duration_secs?: number;
  waveform?: string;
  flags?: number;
}
/** JSON Create Message fields. Files themselves require multipart/form-data. */
export interface MockMessageContent {
  content: string;
  embeds: MockEmbed[];
  nonce?: string | number;
  enforce_nonce?: boolean;
  tts?: boolean;
  allowed_mentions?: MockAllowedMentions;
  message_reference?: MockMessageReference;
  components?: Array<Record<string, unknown>>;
  sticker_ids?: string[];
  attachments?: MockAttachment[];
  flags?: number;
  poll?: Record<string, unknown>;
  shared_client_theme?: Record<string, unknown>;
}
export interface MockMessageInteraction {
  id: string;
  type: 2;
  name: string;
  user: MockUser;
}
export interface MockMessage extends MockMessageContent {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: MockUser;
  member?: MockMember;
  timestamp: string;
  edited_timestamp: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: MockUser[];
  mention_roles: string[];
  mention_channels?: Array<Record<string, unknown>>;
  attachments: MockAttachment[];
  pinned: boolean;
  type: number;
  flags: number;
  components?: Array<Record<string, unknown>>;
  sticker_items?: Array<{ id: string; name: string; format_type: number }>;
  stickers?: Array<Record<string, unknown>>;
  reactions?: Array<Record<string, unknown>>;
  webhook_id?: string;
  activity?: Record<string, unknown>;
  application?: Record<string, unknown>;
  application_id?: string;
  message_reference?: MockMessageReference;
  message_snapshots?: Array<{ message: Record<string, unknown> }>;
  referenced_message?: MockMessage | null;
  thread?: MockChannel;
  position?: number;
  role_subscription_data?: Record<string, unknown>;
  resolved?: Record<string, unknown>;
  poll?: Record<string, unknown>;
  call?: Record<string, unknown>;
  shared_client_theme?: Record<string, unknown>;
  interaction?: MockMessageInteraction;
  interaction_metadata?: {
    id: string;
    type: 2;
    user: MockUser;
    authorizing_integration_owners: Record<string, string>;
  };
}
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
/** 従来の JSON は version / members を省略でき、読み込み時に補完する。 */
export interface MockFixture {
  version?: 1;
  user: MockUser;
  users?: MockUser[];
  guild: {
    id: string;
    name: string;
    owner_id: string;
    roles: MockRole[];
    channels: MockChannel[];
  };
  members?: MockMember[];
  messages: Record<string, MockMessage[]>;
  commands?: MockApplicationCommand[];
}
export interface MockSnapshot extends MockFixture {
  version: 1;
  users: MockUser[];
  members: MockMember[];
  commands: MockApplicationCommand[];
}
export interface CreateUserInput {
  id?: string;
  username: string;
}
export interface CreateChannelInput {
  id?: string;
  name: string;
  type?: 0 | 2;
  permissionOverwrites?: MockPermissionOverwrite[];
}
export interface CreateRoleInput {
  id?: string;
  name: string;
  permissions?: string | bigint;
  color?: number;
}
export interface ResourceCollection<T, Input> {
  create(input: Input): Promise<T>;
  get(id: string): T | undefined;
  list(): T[];
  /** 同名が複数ある場合は曖昧な選択をせずエラーにする。 */
  findByName(name: string): T | undefined;
}
export interface MessageQuery {
  channelId: string;
  authorId?: string;
  afterId?: string;
  interactionId?: string;
}
export interface WaitOptions {
  timeoutMs?: number;
}
export interface TestActor {
  sendMessage(channelId: string, content: string): Promise<MockMessage>;
  /** 登録済み・引数なしコマンドを実行し、その実行に対応する返信を待つ。 */
  runCommand(
    channelId: string,
    name: string,
    options?: WaitOptions,
  ): Promise<MockMessage>;
}
/** Mock を所有する Node.js テストコード専用。ブラウザの認証とは独立する。 */
export interface MockTestController {
  readonly guild: MockFixture["guild"];
  readonly users: ResourceCollection<MockUser, CreateUserInput>;
  readonly channels: ResourceCollection<MockChannel, CreateChannelInput>;
  readonly roles: ResourceCollection<MockRole, CreateRoleInput>;
  readonly members: {
    get(userId: string): MockMember | undefined;
    list(): MockMember[];
    setRoles(userId: string, roleIds: string[]): Promise<MockMember>;
    addRole(userId: string, roleId: string): Promise<MockMember>;
  };
  readonly messages: {
    list(channelId: string): MockMessage[];
    waitFor(
      query: MessageQuery & WaitOptions,
      predicate?: (message: MockMessage) => boolean,
    ): Promise<MockMessage>;
  };
  readonly commands: {
    list(): MockApplicationCommand[];
    waitFor(
      name: string,
      options?: WaitOptions,
    ): Promise<MockApplicationCommand>;
  };
  as(user: string | Pick<MockUser, "id">): TestActor;
  snapshot(): MockSnapshot;
  subscribe(listener: (snapshot: MockSnapshot) => void): () => void;
  reset(): Promise<void>;
}
export interface TestEnvironmentOptions extends WaitOptions {
  fixture?: MockFixture;
  /** 日時を固定できる。タイムアウトには実時間を使う。 */
  now?: () => Date;
  reportTo?: TestRunTarget;
}
export interface TestBotClient extends EventClient {
  destroy(): unknown;
}
export interface TestEnvironment extends MockTestController {
  readonly url: string;
  readonly botToken: string;
  connect<C extends TestBotClient>(client: C): Promise<C>;
  close(): Promise<void>;
  report(progress: TestRunProgress): Promise<void>;
}
