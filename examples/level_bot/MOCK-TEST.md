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

## ブラウザから動作確認（推奨）

ルートで:

```sh
nix-shell
pnpm install
pnpm build
pnpm app
```

app が表示する `TOKEN=mock_...` をリポジトリ直下の `.env` に設定し、別ターミナルから `pnpm bot` を実行します。

```dotenv
# discord用
#TOKEN=<本番用トークン>

# テスト用
TOKEN=mock_ここを払い出された値に置換
```

`pnpm app` は (1) インメモリ PGlite、(2) 127.0.0.1 に限った PostgreSQL ソケットサーバー、(3) Mock REST/Gateway と Web を起動します。`pnpm bot` は標準の `discord.js` Bot だけを起動します。`http://127.0.0.1:3000/test` を開き、ダミーユーザーを選んで投稿してください。

`.discord-mock-data/credentials.json` に `schemaVersion: 1` と `token` を保存します。トークンがなければ新規生成し、あれば再利用します。不正な JSON・不正なトークンはエラーになり、既存ファイルを黙って消しません。Bot は `.env` の `TOKEN`（既存の環境変数を優先）を使用し、旧 `DISCORD_MOCK_TOKEN` もフォールバックとして受け付けます。

app が `.discord-mock-data/runtime.json` に Mock URL と DB 接続先を書き、Bot がこれを読みます。PGlite に `example.lvl` を作成し、通常の `POST_URL` DSN で元の Drizzle / pg に接続するため、DB サーバーや Docker は不要です。Bot だけの再起動では DB を保持し、app を終了すると DB は消えます。トークン JSON は app の終了後も残ります。詳細な設定・ロックファイルの復旧手順は [ルート README](../../README.md#ブラウザで本物の-bot-をテストする) を参照してください。

`pnpm demo` による一括起動も利用できます。この経路ではトークンは実行ごとに新規生成し、`.env` の `TOKEN` は使いません。app のビルドは手動、Bot は TypeScript の直接実行です。

**通常のメッセージに対するレベル更新処理は返信を投稿しません。** ブラウザにはダミーユーザーのメッセージと Bot 接続状態が表示されます。Bot 側が `channel.send` を実行する場合、その REST POST は画面へ反映されます。

Bot が Ready になると `BOT START`・`MockBot` をログ出力し、`packages/bot/src/commands/` 配下の `.ts` を再帰的に自動検出して登録します。`data`（`toJSON()` を持つコマンド定義）と `execute` 関数を export してください。ローダー自身の `main.ts`・`.d.ts`・シンボリックリンク・隠しディレクトリ・node_modules は検出対象外です。日本語コマンド名も利用でき、入力欄の `/` から選択して実行できます。現在は引数なし CHAT_INPUT に限定します。

構文・import・export 形式・toJSON・重複名・登録 API のエラーはファイル単位でスキップし、後続へ進みます。ファイル名と失敗段階をログに出し、例外に含まれるソースやトークンは出しません。同名のコマンドはファイルパス順で最初に成功したものを使い、最大100件を登録します。最後に成功した定義だけで登録一覧を置換するため、削除・失敗したファイルの古い登録も残しません。

`pnpm bot` は `tsx` で `src/bot.ts` と Bot・DB・JS アダプターの TS ソースを実行します。Bot のビルドと import 一覧の編集は不要です。ファイルを追加・変更した後は Bot を再起動してください。起動中の自動再読込は行いません。型エラーの検査は別途 `pnpm check` を使用します。

`showLvl.ts` の `/レベル確認` も自動検出します。通常のメッセージを投稿して `example.lvl` に記録を作ってから実行すると、自分のレベルを Embed で表示します。このコマンドはレベル記録がない場合に返信せず return する実装です。Mock/Web/app を変更した場合は `pnpm build` と app の再起動が必要です。`pnpm app` 自体はビルド済み成果物を起動するだけです。

## E2E

コマンド返信の上には実行ユーザーと `/コマンド名` を表示します。サイドバーの「データベース」からは、キー入力なしで Bot が更新する `example.lvl` を表形式で参照できます。読み取り専用で検索・並び替え・ページ切替・手動更新に対応します。app を止めると DB が消える動作は変わりません。

`pnpm bot` は `bot.lock` で同じ app 保存先への重複起動を拒否します。初期返信を複数の Bot が同時に送った場合も、Mock は1件だけを受理し、2件目からは `40060` を返します。別のコマンド実行として送信された返信までまとめる処理は行いません。

app を先に Ctrl+C で停止しても、接続済み Bot は DB の切断イベントまたは `/health` の停止を検知して終了します。DB 接続エラーのオブジェクト全体は出力しません。SDK と DB の終了処理を開始し、SDK の再接続待ちが長引いた場合も最大3秒の待機後にロックを解放して CLI を終了します。再開時は app → Bot の順です。実際の SIGINT、DB 使用後の切断、DB 未使用時の停止検知、同じ保存先での再起動をテストします。

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

起動中の app に表示したい場合は `pnpm bot:test:web` を実行します。**`http://127.0.0.1:3000/test` を開いたままでも**、自動テストの最新の実行内容・ステップ・メッセージ・Bot の返信・成功／失敗が読み取り専用のパネルにリアルタイムで反映されます。`/tests` では過去の実行一覧・詳細も確認できます。通常の `pnpm bot:test` も app があれば自動で反映します。表示先は runtime.json の URL、または DISCORD_MOCK_REPORT_URL を使用します。テストは独立した Mock/DB を使用し、普段のチャットや DB は変更しません。結果は app が起動している間、最大20件保持します。Web の変更を反映するには `pnpm build` と `pnpm app` の再起動、および開いている `/test` の再読み込みが必要です。

`pnpm sample:test` は Bot に加えて `tests/integration/` の app・DB・起動処理も検証します。`pnpm automation:test` は SDK の自動テスト例と Bot テストの両方を実行します。既存の `pnpm level:test` / `pnpm level:test:web` は新コマンドの別名として利用できます。
