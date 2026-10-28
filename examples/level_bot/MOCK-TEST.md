# level_bot: upstream dev_container_ts_bot + embedded PostgreSQL

移植元: https://github.com/furimu1234/dev_container_ts_bot （MIT ライセンスは [LICENSE](LICENSE) に保存）

## 保持したもの

- `packages/bot/src/**` と `packages/db/src/**` の構成、実際の `events/leveling.ts`、`Container()`、`getLevel`・`createLeveling`・`updateLeveling`、Drizzle / `pg`。
- `src/main.ts` を共通の Client 作成・イベント登録・Ready 初期化として利用し、`src/local.ts` がローカル接続を担当します。**デモ Bot に Fake DB は差し込まない**。
- Node 24 / pnpm 11 用 Dev Container を `.devcontainer/` に維持。元の manifest は `upstream.package.json` と `upstream.pnpm-workspace.yaml` に保存。

## 修正したバグ

- PostgreSQL の `userId` 列名が `server_id` と重複していたため `user_id` に修正
- Bot が人間のメッセージを無視していた `message.author.bot` 判定を修正
- `Container()` がメッセージごとに新しい `pg.Pool` を生成していた部分を1つのプールに集約
- `TOKEN` / `POST_URL` の評価タイミングを起動時に変更
- `pnpm bot` が別の Client を作り、`main.ts` の Ready ハンドラーを登録していなかった問題を修正。ログイン完了に加え、Ready の非同期コマンド登録完了も待ちます。
- 既定の接続先を使う `new REST()` を廃止し、Mock に設定済みの `client.rest` から登録します。

## ブラウザでテストを実行する（推奨）

```sh
pnpm install
pnpm build
pnpm app
```

`pnpm app` は Mock REST / Gateway、Web、PGlite を起動します。初回は `.discord-mock-data/credentials.json` にテスト用トークンを発行し、**保存済みのトークンがある次回起動から** Bot クライアントを自動起動します。既存の `.env` に設定された `TOKEN` が保存済みトークンと違う場合は、app は起動したまま Bot のみ起動を見送り、`pnpm bot:test` を使った設定確認を案内します。Bot 単体を手動起動する場合は `pnpm bot:client` を使用してください。

`http://127.0.0.1:3000/test` は Discord 風の自動テスト画面です。右側「ユーザー」タブで Alice / Bob などを切り替えると、UT ソースの `users: "login"` で指定されたユーザーとして操作を実行します。左のチャンネル一覧でチャットを選択でき、中央にはダミーユーザーの投稿・Bot の返信・Embed のみ表示します。テスト開始・検証ステップ・合否は右の独立した実行ログに表示します。下部のテストケース名ボタンを押すと個別の Vitest ケースを起動します。すべてのテストを実行するときは `pnpm bot` を別ターミナルから実行します。`/tests` にも実行履歴が表示されます。

```sh
pnpm bot
```

テストケースには独立した Mock・DB・Bot を用意するため、App の通常状態や PGlite データは変更しません。App 再起動時には結果一覧がリセットされます。ブラウザを開いたままでも再接続を試み、変更の反映に `pnpm build` と App 再起動、必要に応じたブラウザ更新が必要です。

`pnpm demo` は従来の単独デモ起動として引き続き利用できます。Bot 本体の `packages/bot/src/commands/` には従来どおり TypeScript のコマンドを追加できます。コマンド登録・DB 接続は今までの Drizzle / `pg` を使い、疑似 DB に差し替えません。

## E2E

コマンド返信の上には実行ユーザーと `/コマンド名` を表示します。サイドバーの「データベース」からは、キー入力なしで Bot が更新する `example.lvl` を表形式で参照できます。読み取り専用で検索・並び替え・ページ切替・手動更新に対応します。app を止めると DB が消える動作は変わりません。

`pnpm bot:client` は `bot.lock` で同じ app 保存先への重複起動を拒否します。初期返信を複数の Bot が同時に送った場合も、Mock は1件だけを受理し、2件目からは `40060` を返します。別のコマンド実行として送信された返信までまとめる処理は行いません。

app を先に Ctrl+C で停止しても、接続済み Bot は DB の切断イベントまたは `/health` の停止を検知して終了します。DB 接続エラーのオブジェクト全体は出力しません。SDK と DB の終了処理を開始し、SDK の再接続待ちが長引いた場合も最大3秒の待機後にロックを解放して CLI を終了します。通常は app が Bot を自動起動します。手動で分ける場合のみ app → `pnpm bot:client` の順です。実際の SIGINT、DB 使用後の切断、DB 未使用時の停止検知、同じ保存先での再起動をテストします。

静的チェックはルートの `pnpm check`、サンプルだけなら `pnpm --filter @ex/bot typecheck`・`pnpm --filter @ex/db typecheck`・`pnpm --filter @discord-mock/level-bot typecheck`・`pnpm --filter @discord-mock/level-bot lint` で実行できます。ビルド済みファイルに依存せず、Bot 本体と Drizzle 設定も検査します。

```sh
pnpm sample:test
```

別の Mock/DB/Bot を起動し、ブラウザ API から2通投稿して、本物の PostgreSQL クエリでレベル 2 → 3 を確認します。Bot を別プロセスで起動・再起動するケースと、app の再起動でトークンを再利用するケースも実行します。保存先・接続先は手動起動中の app と分離しています。

`/admin` はまだ簡易画面です。DM / VC の模擬および Discord 全 API の互換は未実装です。

## Bot の UT

```sh
pnpm bot:test
```

Bot の機能だけをまとめて検証します。app を別に起動する必要はありません。テストはすべて TypeScript です。

- `tests/bot/showLvl.test.ts`: 投稿してから `/レベル確認` を実行する流れ、Guild と実行者の絞り込み、未登録ユーザーの現在の動作。
- `tests/bot/leveling.test.ts`: 投稿ごとのレベル更新と、投稿していない人のレベルが変わらないこと。
- `tests/helpers/bot-test.ts`: 本物の Bot・PGlite・pg / Drizzle・Mock の準備、後片付け、Web への実行結果の反映。

テスト本文では HTTP ヘッダー・接続先・DB 起動処理を書く必要はありません。

```ts
import { test, expect } from '../helpers/bot-test.js';

test('レベル確認で7を返す', async ({ bot }) => {
  await bot.levels.set(bot.alice, 7);
  const reply = await bot.as(bot.alice).command('レベル確認');
  expect(reply.embeds[0].fields?.[0].value).toBe('7');
});
```

今後の機能も `tests/bot/` に `*.test.ts` を追加すれば `pnpm bot:test` で実行します。Bot のソースは直接実行し、テスト時に暗黙のビルドを行いません。

起動中の app に表示したい場合は `pnpm bot` を実行します。**`http://127.0.0.1:3000/test` を開いたままでも**、ユーザー投稿と Bot の返信がチャットに、テストの実行ステップと成功／失敗が右側の実行ログにリアルタイムで反映されます。`/tests` では過去の実行一覧・詳細も確認できます。通常の `pnpm bot:test` も app があれば自動で反映します。表示先は runtime.json の URL、または DISCORD_MOCK_REPORT_URL を使用します。テストは独立した Mock/DB を使用し、普段のチャットや DB は変更しません。結果は app が起動している間、最大20件保持します。Web の変更を反映するには `pnpm build` と `pnpm app` の再起動、および開いている `/test` の再読み込みが必要です。

`pnpm sample:test` は Bot に加えて `tests/integration/` の app・DB・起動処理も検証します。`pnpm automation:test` は SDK の自動テスト例と Bot テストの両方を実行します。既存の `pnpm level:test` / `pnpm level:test:web` は新コマンドの別名として利用できます。

### UT の実行ユーザーを test() で指定

`test("ケース名", { users: "login" }, async ({ bot, user, actor }) => { ... })` のように、第2引数でテスト対象を指定します。

```ts
// /test の右側でログインしたユーザーとして実行
test("レベル確認", { users: "login" }, async ({ bot, user, actor }) => {
  await bot.levels.set(user, 7);
  const reply = await actor.command("レベル確認");
  expect(reply.embeds[0].fields?.[0].value).toBe("7");
});

// 全ダミーユーザー（Bot除外）について同じ検証を順次実行
test("全員の投稿", { users: "all" }, async ({ user, actor }) => {
  await actor.sendMessage(`${user.username} から投稿`);
});

// ユーザー ID を明示
test("指定ユーザー", { users: { id: "123456789000000099" } }, async ({ actor }) => {
  await actor.sendMessage("ID指定の投稿");
});

// 複数IDでテスト本文を順次実行
test("複数ID", { users: { ids: ["123456789000000098", "123456789000000099"] } }, async ({ user, actor }) => {
  await actor.sendMessage(`${user.username} の投稿`);
});
```

`user` は対象ユーザー、`actor` はそのユーザーとして投稿・コマンド実行できる操作クライアントです。`bot.levels.set(user, ...)` などの状態準備も同じユーザーを参照します。`"all"` では同じテスト本文を各ユーザーについて順に実行します。従来の `bot.as(user)` も残していますが、テスト実行対象は各操作ではなく `test()` の第2引数で指定します。

`"login"` は `/test` 右側の「ユーザー」タブからログイン先を変更したユーザーです。左クリックでロール等のプロフィール、右クリックでIDコピーとログイン切替を操作できます。初期ダミーユーザーは10人で、ログは「実行ログ」タブにあります。CLIで `pnpm bot` を実行するときは既定の Alice を使い、`DISCORD_MOCK_SELECTED_USER_ID` で上書きできます。未知のIDやBotアカウントにはフォールバックしません。



### チャットの固定レイアウトとテストDB

`/test` の表示領域はブラウザの高さに固定され、**中央のチャットだけが縦スクロール**します。テストのメッセージが増えるたびに最新メッセージへ自動スクロールし、左右サイドバー・上部ヘッダー・下部のテストケースボタンは常時表示します。サイドバー内の一覧が長い場合は各一覧だけをスクロールします。

テストで `actor.sendMessage(...)` を送ると、Botの実際の `messageCreate` ハンドラーが動いて、Drizzle/`pg` 経由で**テスト専用の実PGlite DB**にレコードが保存されます。テスト内の `bot.levels.set(user, ...)` で直接初期データを用意する方法も従来どおり利用できます。

`/database` の上部「表示するDB」には **AppのDB** と **テスト: テストケース名** が表示されます。テスト完了時にテストPGliteから読み取り専用のスナップショットを収集し、テストDBを選ぶと `example.lvl` など実際に書き込まれたレコードを参照できます。特定のテーブルに限定せず、追加されたカスタムテーブルも同じ方式で表示します。

テスト実行とAppは別DBです。**テストのレコードをAppのDBに書き込んだり、テスト終了後もテストDBプロセスを常駐させたりはしません。** 終了後に参照するのはコピーで、テスト失敗時も取得可能な範囲で保持します。スナップショットは最大32テーブル・各100行・合計約32KiBに制限し、長い値は省略します。全件の永続保存ではなく表示用の抜粋で、アプリ再起動時にクリアされます。テストの進行中ではなく**完了時に最新のDB状態を反映**します。選択するテストがまだ終わっていない場合、完了後にDB画面を開くか「更新」で一覧を取得してください。

