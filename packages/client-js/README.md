# discord.js / Sapphire Mock Client (TypeScript)

`disMockClient(client)` accepts an existing discord.js `Client` or Sapphire `SapphireClient` and **changes the REST base URL** on that instance to localhost. Discord.js resolves its Gateway host via `/gateway/bot`; our server returns a local `ws://` URL.

```ts
import { Client } from "discord.js";
import { disMockClient, disMockMixin } from "@discord-mock/client-js";

const client = new Client({ intents: [], rest: {api:"http://127.0.0.1:3000/api"} });
const utClient = disMockClient(client);
await utClient.connect("mock_<CLIが発行するトークン>");

class MyBot extends Client {}
class UtBot extends disMockMixin(MyBot) {}
const bot = new UtBot({ intents: [] });
await bot.mock.connect("mock_<CLIが発行するトークン>");
```

SapphireClient も `disMockClient` / `disMockMixin` で同様に利用できます。**REST と基本 Gateway ハンドシェイクのみ**実装中。コマンド・モデル・音声の完全互換はありません。SDK が別経路に通信する場合に備えて、テスト実行環境は外向き通信をネットワークで遮断してください。

開発: リポジトリの開発シェルで `pnpm install` と `pnpm build` を明示的に実行します。
配布・利用: 出力 `dist/index.js` を Node.js から読み込みます。pnpm は不要です。SDK はアプリ側の依存として必要です。

## Bot の自動テスト

`@discord-mock/client-js/testing` は、専用 Mock の起動・リソース作成・Bot 接続・操作・返信待ち・終了を扱います。`beforeEach` / `afterEach` で環境を分け、通常の `expect` で検証できます。トークンは Mock 内で生成されます。

```ts
import { beforeEach, afterEach, it, expect } from "vitest";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { createTestEnvironment, type TestEnvironment } from "@discord-mock/client-js/testing";

let mock: TestEnvironment;
beforeEach(async () => { mock = await createTestEnvironment(); });
afterEach(async () => { await mock.close(); });

it("ユーザーの投稿に Bot が返信する", async () => {
  const user = await mock.users.create({ username: "テスト太郎" });
  const channel = await mock.channels.create({ name: "bot-test" });
  const role = await mock.roles.create({ name: "テスター" });
  await mock.members.addRole(user.id, role.id);

  // 自分の Bot をテストする場合は、その Client の生成・ハンドラー登録処理を使う。
  const bot = new Client({ intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
  ] });
  bot.on(Events.MessageCreate, message => {
    if (message.author.bot) return;
    void message.channel.send("こんにちは！");
  });
  await mock.connect(bot);

  const sent = await mock.as(user).sendMessage(channel.id, "hello");
  const reply = await mock.messages.waitFor({
    channelId: channel.id, afterId: sent.id,
  }, message => message.author.bot);
  expect(reply.content).toBe("こんにちは！");
});
```

`mock.connect(bot)` が返すのは渡した同じ Client インスタンスです。Bot の通常の `login()` は呼ばず、この接続を使います。ハンドラー内の非同期エラーは Bot 側で処理してください。リポジトリの [実行例](tests/automation.test.ts) では捕捉したエラーも検証しています。

初期データには Alice / Bob / general / @everyone があり、各コレクションの `get(id)`・`findByName(name)`・`list()` で取得できます。名前はユーザーなら `username`、チャンネル・ロールなら `name` の完全一致です。見つからなければ `undefined`、同名が複数あればエラーを返します。取得値はコピーなので、変更には `create()` や `members.setRoles()` / `addRole()` を使います。

コマンドは Bot が通常どおり登録します。登録完了を待ってから、実行ユーザーを指定します。

```ts
await mock.commands.waitFor("ping");
const reply = await mock.as(user).runCommand(channel.id, "ping");
expect(reply.content).toBe("Pong!");
expect(reply.interaction_metadata?.user.id).toBe(user.id);
```

`runCommand()` はその実行 ID に対応する返信を待ちます。メッセージ待ちは過去の一致も検索するため、新しい投稿への応答を待つ場合は `afterId` を指定します。標準の待ち時間は3秒で、環境作成時または各待機の `timeoutMs` で変更できます（1〜60000ms）。

JSON フィクスチャを使う場合:

```ts
import { readFile } from "node:fs/promises";
const fixture = JSON.parse(await readFile("./fixtures/mock-state.json", "utf8"));
const mock = await createTestEnvironment({ fixture });
// mock.snapshot() で同じ形式の状態を取得できる。
```

フィクスチャは実行中の app と共有せず、読み込み時にコピー・検証します。日時は `now: () => new Date("2026-01-01T00:00:00Z")`、作成するリソースの ID は `create({ id: "223456789000000001", ... })` で固定できます。`reset()` は初期フィクスチャに戻し、接続した Bot を切断します。再接続する場合は新しい Client を用意してください。

このサブパスの配布物 `dist/testing.cjs` には Mock サーバー・Web・依存を同梱し、実行時の pnpm・ビルド・別サーバーは不要です。Bot とテストランナーの依存は利用側で用意します。リポジトリでは手動で `pnpm build` した後に `pnpm automation:test`、または既存テストを含む `pnpm test` で実行します。

### 起動中の app へ実行内容を表示する

```ts
const mock = await createTestEnvironment({
  reportTo: { baseUrl: "http://127.0.0.1:3000", name: "レベル確認のテスト" },
});
try {
  await mock.report({ step: "ユーザーと DB を準備" });
  // リソース作成・Bot 接続・投稿・コマンド実行・expect など
  await mock.report({ status: "passed", step: "検証完了" });
} catch (error) {
  await mock.report({ status: "failed", step: "検証失敗" });
  throw error;
} finally {
  await mock.close();
}
```

app の `/tests` で状態変更とメッセージ・Embed・実行者を確認できます。`as(user)` の投稿・コマンド実行は操作の経過にも自動で追記します。完了を報告しないまま `close()` すると「中断」になります。送信はローカル app の管理セッションと CSRF を使い、接続失敗・不正なデータ・サイズ超過をエラーにします。`reportTo` を省略すると外部の app へ送信しません。

`subscribe(listener)` でローカルの状態変更を購読し、戻り値の関数で解除することもできます。表示用コピーはテスト環境と app の通常データの双方から独立し、app の Bot へイベントを再配信しません。

対応範囲は単一 Guild のユーザー・テキスト / VC 定義・ロール・所属ロール、投稿、登録済みの引数なしコマンドへの公開返信です。VC の実音声・DM・コマンド引数・defer 後の編集 / follow-up・ephemeral は未対応です。権限の対応範囲は [共有契約](../../spec/testing.md) を参照してください。Python への API 追加は今回含みません。
