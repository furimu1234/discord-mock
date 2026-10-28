import type {
  MockTestController,
  MessageQuery,
  WaitOptions,
  ResourceCollection,
} from "../../../packages/client-js/src/testing-types.js";
import type { MockEnvironment } from "./environment.js";
import type { LoadedMockState, MockUser, MockMessage } from "./models.js";
import {
  requireChannelPermission,
  USE_APPLICATION_COMMANDS,
} from "./permissions.js";
import {
  ResourceError,
  validateId,
  validateName,
} from "./resource-validation.js";
import { MockResources } from "./resources.js";

export function validateTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new ResourceError("待ち時間は 1〜60000ms にしてください");
  return timeoutMs;
}

/** Node.js 所有者 API。HTTP から認証を省略する経路は追加しない。 */
export class MockTesting implements MockTestController {
  readonly users: MockTestController["users"];
  readonly channels: MockTestController["channels"];
  readonly roles: MockTestController["roles"];
  readonly members: MockTestController["members"];
  readonly messages: MockTestController["messages"];
  readonly commands: MockTestController["commands"];
  private readonly initial: LoadedMockState;
  private readonly pending = new Set<(error: Error) => void>();
  private closed = false;

  constructor(
    private readonly environment: MockEnvironment,
    private readonly connectionCount: () => number,
    private readonly timeoutMs = 3000,
  ) {
    validateTimeout(timeoutMs);
    this.initial = structuredClone(environment.state);
    const resources = new MockResources(environment);
    const guarded = <T, Input>(
      collection: ResourceCollection<T, Input>,
    ): ResourceCollection<T, Input> => ({
      ...collection,
      create: async (input) => {
        this.assertOpen();
        return collection.create(input);
      },
    });
    this.users = guarded(resources.users);
    this.channels = guarded(resources.channels);
    this.roles = guarded(resources.roles);
    this.members = {
      get: (userId) => {
        validateId(userId);
        return structuredClone(
          environment.state.members.find((member) => member.user.id === userId),
        );
      },
      list: () => structuredClone(environment.state.members),
      setRoles: async (userId, roleIds) => {
        this.assertOpen();
        return resources.setRoles(userId, roleIds);
      },
      addRole: async (userId, roleId) => {
        this.assertOpen();
        const member = this.members.get(userId);
        if (!member) throw new ResourceError("メンバーが存在しません", 404);
        return resources.setRoles(userId, [
          ...new Set([...member.roles, roleId]),
        ]);
      },
    };
    this.messages = {
      list: (channelId) => {
        if (!this.channels.get(channelId))
          throw new ResourceError("チャンネルが存在しません", 404);
        return structuredClone(environment.state.messages[channelId] ?? []);
      },
      waitFor: (query, predicate) =>
        this.wait(
          () => this.findMessage(query, predicate),
          `チャンネル ${query.channelId} のメッセージ`,
          query,
        ),
    };
    this.commands = {
      list: () => structuredClone(environment.availableCommands()),
      waitFor: async (name, options) => {
        validateName(name, 32);
        return this.wait(
          () =>
            environment
              .availableCommands()
              .find((command) => command.name === name),
          `コマンド /${name} の登録`,
          options,
        );
      },
    };
  }

  get guild() {
    return structuredClone(this.environment.state.guild);
  }
  snapshot(): LoadedMockState {
    this.assertOpen();
    return structuredClone(this.environment.state);
  }

  subscribe(listener: (snapshot: LoadedMockState) => void): () => void {
    this.assertOpen();
    const changed = () => { if (!this.closed) listener(this.snapshot()); };
    this.environment.on("changed", changed);
    return () => this.environment.off("changed", changed);
  }

  private assertOpen(): void {
    if (this.closed) throw new ResourceError("テスト環境は終了しています");
  }

  private findMessage(
    query: MessageQuery,
    predicate?: (message: MockMessage) => boolean,
  ): MockMessage | undefined {
    if (query.afterId !== undefined) validateId(query.afterId);
    if (query.authorId !== undefined) validateId(query.authorId);
    if (query.interactionId !== undefined) validateId(query.interactionId);
    return this.messages
      .list(query.channelId)
      .find(
        (message) =>
          (!query.authorId || message.author.id === query.authorId) &&
          (!query.afterId || BigInt(message.id) > BigInt(query.afterId)) &&
          (!query.interactionId ||
            message.interaction_metadata?.id === query.interactionId) &&
          (!predicate || predicate(message)),
      );
  }

  private async wait<T>(
    read: () => T | undefined,
    description: string,
    options: WaitOptions = {},
  ): Promise<T> {
    this.assertOpen();
    const timeoutMs = validateTimeout(options.timeoutMs ?? this.timeoutMs);
    return new Promise<T>((resolve, reject) => {
      const finish = (error?: Error, result?: T) => {
        clearTimeout(timer);
        this.environment.off("changed", check);
        this.pending.delete(cancel);
        if (error) reject(error);
        else resolve(structuredClone(result as T));
      };
      const cancel = (error: Error) => finish(error);
      const check = () => {
        try {
          const result = read();
          if (result !== undefined) finish(undefined, result);
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("待機条件の評価に失敗しました"),
          );
        }
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              `${description} を ${timeoutMs}ms 待ちましたが完了しませんでした`,
            ),
          ),
        timeoutMs,
      );
      this.pending.add(cancel);
      this.environment.on("changed", check);
      check();
    });
  }

  as(
    user: string | Pick<MockUser, "id">,
  ): ReturnType<MockTestController["as"]> {
    const userId = typeof user === "string" ? user : user.id;
    const actor = () => {
      this.assertOpen();
      const current = this.users.get(userId);
      if (!current)
        throw new ResourceError("ダミーユーザーが存在しません", 404);
      return current;
    };
    actor();
    return {
      sendMessage: async (channelId, content) => {
        if (
          typeof content !== "string" ||
          !content.trim() ||
          content.length > 2000
        )
          throw new ResourceError("メッセージは 1〜2000 文字にしてください");
        return structuredClone(
          await this.environment.postMessage(channelId, content, actor()),
        );
      },
      runCommand: async (channelId, name, options) => {
        const current = actor();
        validateTimeout(options?.timeoutMs ?? this.timeoutMs);
        if (this.channels.get(channelId)?.type !== 0)
          throw new ResourceError("テキストチャンネルが存在しません", 404);
        requireChannelPermission(
          this.environment.state,
          current.id,
          channelId,
          USE_APPLICATION_COMMANDS,
        );
        const command = this.environment
          .availableCommands()
          .find((command) => command.name === name);
        if (!command)
          throw new ResourceError("コマンドが登録されていません", 404);
        const interaction = this.environment.createInteraction({
          actor: current,
          channelId,
          commandName: command.name,
          commandId: command.id,
          commandGuildId: command.guild_id,
          showReplyInTimeline: true,
        });
        return this.messages.waitFor({
          channelId,
          interactionId: interaction.id,
          ...options,
        });
      },
    };
  }

  async reset(): Promise<void> {
    this.assertOpen();
    await this.wait(
      () => (this.connectionCount() === 0 ? true : undefined),
      "Bot の切断",
    );
    await this.environment.flush();
    this.assertOpen();
    this.cancelWaits(
      new Error("テスト環境をリセットしたため待機を終了しました"),
    );
    Object.assign(this.environment.state, structuredClone(this.initial));
    this.environment.interactions.clear();
    await this.environment.commit();
  }

  private cancelWaits(error: Error): void {
    for (const cancel of this.pending) cancel(error);
  }
  close(): void {
    this.closed = true;
    this.cancelWaits(new Error("テスト環境を終了したため待機を終了しました"));
  }
}
