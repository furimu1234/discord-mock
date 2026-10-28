# discord.js / Sapphire Mock Client (TypeScript)

## テストファイルだけを追加する

任意の名前のテストクライアントを1つ用意し、そこから `runTestClient(import.meta.url, options)` を呼びます。そのファイルを実行すると、ローカル Mock・ブラウザ画面・Bot が起動します。`main.ts` の編集は不要です。利用側に App 用の `src`、`tests/helpers`、`tests/integration`、Vitest 設定ファイルを作る必要はありません。

テストは `dismock/e2e` から `test`・`expect`・`describe` を読み込み、`tests/**/*.test.ts` に追加します。`tests/bot` の名前は固定ではなく、`tests/ping.test.ts` や `tests/commands/replies/ping.test.ts` も使えます。

```ts
// tests/ping.test.ts
import { test, expect } from "dismock/e2e";

test("ユーザーの投稿に返信する", { users: "login" }, async ({ bot, actor }) => {
  const sent = await actor.sendMessage("こんにちは");
  const reply = await bot.mock.messages.waitFor(
    { channelId: bot.channel.id, afterId: sent.id },
    message => message.author.bot,
  );
  expect(reply.content).toBe("返信");
});
```

`users` は `"login"` / `"all"` / `{id}` / `{ids}` を受け付けます。複数ユーザーは1人ずつ順番に本文を実行し、actor の ID・ユーザー情報・権限をそのユーザーに合わせます。標準の bot は `mock`・`guild`・`channel`・`users`・`channels`・`roles`・`messages()`・`as(user)` を持ちます。`mock` は従来の `createTestEnvironment()` と同じ操作 API です。

最初の導入時には、テストクライアントに Bot 固有の起動・終了を登録します。次の `testClient.ts` は別の名前や場所でも構いません。singleton を export している Bot は、ケースごとに別のモジュールとして読み込みます。Bot に既存の Client factory がある場合はそれも使えます。

```ts
// testClient.ts
import * as disMock from "dismock/client";
import { runTestClient } from "dismock/e2e";

let instance = 0;
await runTestClient(import.meta.url, {
  async bot({ url, token }) {
    const { client, main } = await import(
      /* @vite-ignore */ `./main.ts?test=${++instance}`
    ) as typeof import("./main.js");
    const { failures } = await disMock.Client(client, main, { baseUrl: url })(token);
    return {
      failures,
      async close() {
        await client.destroy();
        // Bot 固有の DB 接続などもここで終了する。
      },
    };
  },
});
```

```sh
# 利用先のプロジェクトで実行（Node.js 24.17以降）
npm install --save-dev vitest@5 tsx
npx tsx testClient.ts                 # Mock・画面・Botをまとめて起動
npx tsx testClient.ts --test          # tests配下を実行。Appなしでも利用可能
npx tsx testClient.ts --test tests/ping.test.ts
npx tsx testClient.ts --test-web      # 起動済みAppへテスト結果を表示
```

テストクライアントは import されたときには設定の登録だけを行い、直接実行されたときだけ起動します。ファイル名の固定や別の App エントリーポイントは不要です。プロジェクトの `tests` を持つ `package.json` の位置を自動検出し、必要なら `root` と `tsconfig` を明示できます。待受先は `127.0.0.1`、保存先はプロジェクトの `.discord-mock-data` です。`DISCORD_MOCK_PORT` と `DISCORD_MOCK_DATA_DIR` で変更できます。実トークンは使わず、自動生成した `mock_` トークンで Bot を起動します。

テストランナーには利用先の Vitest 5 を使用し、共通の fixture・後片付け・対象ユーザーの検証・Appへのレポート送信は配布物が担当します。接続した Client などの Bot 固有リソースは `bot` が返す `close()` で終了します。通常の Node.js で Client や `createTestEnvironment()` だけを使う場合は Vitest を読み込みません。

DB を使う Bot では `database: { sql: "CREATE TABLE ..." }` を指定します。PGlite と PostgreSQL 接続用のローカル TCP リスナーをライブラリが起動し、`bot({databaseDsn})` へ接続先を渡します。Bot 固有のテーブル定義はテストクライアントに置きます。App 稼働中はその DB を通常 Bot と全テストで共有し、App がないときはテスト実行全体で1つの一時 DB を使用します。ケース間で初期化せず、App またはテスト実行の終了時に閉じます。DB が不要なら `database` を省略できます。

Bot 固有の検証 API は `runTestClient` の `extend({mock}, running)` で追加できます。型はアダプター内の `declare module "dismock/e2e" { interface BotTestExtensions { ... } }` で拡張し、そのファイルをプロジェクトの型チェック対象へ含めてください。サンプルの `bot.levels.get/set` はこの方法で実装しています。

Web からのケース一覧・個別実行も自動設定します。tests 直下と任意の階層を静的に検索し、同名ファイルは相対パスで区別します。シンボリックリンクは追跡せず、登録されていない ID から任意のファイルや OS コマンドは実行できません。管理認証と CSRF 検証を維持しています。`--bot` は起動済み App への Bot 単体接続、`--app` は従来の初回トークン保存・次回からの Bot 自動起動を行います。通常はフラグなしの起動で十分です。

既存の Vitest 設定へ組み込む場合は、引き続き `configureE2E({start, extend?})` と `defineE2EConfig({setup: "./testClient.ts"})` を使えます。独自 DB の globalSetup には `createSharedDatabaseSetup(startDatabase)` を利用できます。低レベルのケースランナーは `dismock/e2e/runner`、プログラムからの App 起動は `dismock/runtime` でも公開しています。

ライブラリの統合テストは `packages/client-js/tests/level-bot/` にあり、開発時に `pnpm --filter dismock test:integration` で実行します。この検証用ツリーを npm 利用者が作成・コピーする必要はありません。

## 既存の main.ts を変更せずに使う

`Client(client, main, { baseUrl })` をテスト専用ファイルから呼び出します。既存の `main.ts` が Client と起動関数を export していれば、イベントハンドラー・DB処理・内部の `client.login(TOKEN)` を書き換える必要はありません。

```ts
// testClient.ts（既存の main.ts とは別ファイル）
import * as disMock from "dismock/client";
import { createTestEnvironment } from "dismock/e2e";
import { client, main } from "./main.js";

const mock = await createTestEnvironment();
try {
  const testClient = disMock.Client(client, main, { baseUrl: mock.url });
  const result = await testClient(mock.botToken);
  // 既存 main の戻り値をその型のまま受け取り、mock.as(user) で操作する。
} finally {
  await client.destroy();
  await mock.close();
  // DBなど、Bot固有の接続もここで終了する。
}
```

`baseUrl` を省略すると `http://127.0.0.1:3000` の起動済み Mock に接続します。渡した同じ Client の公開 REST 設定をローカルへ向け、起動中だけそのインスタンスの `login()` を差し替えます。`main` は `(client, connect) => ...` のほか、上例の引数なし関数でも構いません。`main` は `client.login()` または渡された `connect()` を呼びます。両方を呼んでも接続は一度だけです。元の `TOKEN` の値は接続に使わず、テスト側から渡した `mock_` トークンだけを SDK に渡します。環境変数のトークンは変更しません。

公開 EventEmitter API で `clientReady` の発火と、接続前に登録済みのリスナーが返す Promise を待機します。SDK の `login()` が Ready より先に解決する場合も待ちます。起動終了時には `login` と残っているリスナーを戻し、発火済みの `once` は再登録しません。REST は Bot の応答を引き続き Mock へ送るためローカルのまま維持します。起動失敗時は Client を切断して元のエラーを返します。main 自体や初期化が完了しない場合の上限は、利用するテストランナーで設定してください。

import 時点で自動的に本番へログインするエントリーポイントは、import 後のラッパーでは制御できません。Client と起動関数を安全に import できるモジュールを使ってください。Bot を繰り返しテストするときはケースごとに新しい Client を用意します。サンプルの `testClient.ts` では、singleton を export する `main.ts` をケースごとに別モジュールとして読み込み、共有PGliteは維持しています。

### npm インストール

現在はレジストリ未公開です。リポジトリで `pnpm build` を明示的に実行後、配布用ファイルを作成して利用先でインストールできます。

```sh
# このリポジトリで実行
npm pack ./packages/client-js --pack-destination /tmp

# 利用先のプロジェクトで実行
npm install --save-dev /tmp/dismock-0.1.0.tgz
```

利用先には Node.js 24.17 以降と既存 Bot の依存（discord.js等）が必要です。配布物に実行用コード・型定義・テスト用Mockを同梱しており、利用先で pnpm やこのリポジトリのソースは必要ありません。インストールするパッケージ名は `dismock`、import は `dismock/client` と `dismock/e2e` です。[npm の命名規則](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#name) に合わせて小文字に統一し、変数名には `disMock` を使用できます。npm公開は別途有効化するまで行いません。利用環境は本人管理の PC / VPS に限定します。

`disMockClient(client)` accepts an existing discord.js `Client` or Sapphire `SapphireClient` and **changes the REST base URL** on that instance to localhost. Discord.js resolves its Gateway host via `/gateway/bot`; our server returns a local `ws://` URL.

```ts
import { Client } from "discord.js";
import { disMockClient, disMockMixin } from "dismock/client";

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

`dismock/e2e` は、専用 Mock の起動・リソース作成・Bot 接続・操作・返信待ち・終了を扱います。`beforeEach` / `afterEach` で環境を分け、通常の `expect` で検証できます。トークンは Mock 内で生成されます。

```ts
import { beforeEach, afterEach, it, expect } from "vitest";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { createTestEnvironment, type TestEnvironment } from "dismock/e2e";

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
