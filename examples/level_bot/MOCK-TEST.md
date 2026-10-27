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

`pnpm demo` による一括起動も利用できます。この経路ではトークンは実行ごとに新規生成し、`.env` の `TOKEN` は使いません。ビルドはすべて手動です。

**通常のメッセージに対するレベル更新処理は返信を投稿しません。** ブラウザにはダミーユーザーのメッセージと Bot 接続状態が表示されます。Bot 側が `channel.send` を実行する場合、その REST POST は画面へ反映されます。

Bot が Ready になると `BOT START`・`MockBot` をログ出力し、サンプルコマンドを登録します。テキスト入力欄の `/` から選択して送信すると Bot の応答が返ります。日本語コマンド名も利用できます。コマンドを追加する場合は `packages/bot/src/commands/` にモジュールを作り、`commands/main.ts` の `commandModules` に import を追加して手動でビルドしてください。ランタイムでは `.ts` ファイルを走査しません。現在は引数なしの CHAT_INPUT に限定します。

## E2E

コマンド返信の上には実行ユーザーと `/コマンド名` を表示します。サイドバーの「データベース」からは、キー入力なしで Bot が更新する `example.lvl` を表形式で参照できます。読み取り専用で検索・並び替え・ページ切替・手動更新に対応します。app を止めると DB が消える動作は変わりません。

`pnpm bot` は `bot.lock` で同じ app 保存先への重複起動を拒否します。初期返信を複数の Bot が同時に送った場合も、Mock は1件だけを受理し、2件目からは `40060` を返します。別のコマンド実行として送信された返信までまとめる処理は行いません。

静的チェックはルートの `pnpm check`、サンプルだけなら `pnpm --filter @ex/bot typecheck`・`pnpm --filter @ex/db typecheck`・`pnpm --filter @discord-mock/level-bot typecheck`・`pnpm --filter @discord-mock/level-bot lint` で実行できます。ビルド済みファイルに依存せず、Bot 本体と Drizzle 設定も検査します。

```sh
pnpm sample:test
```

別の Mock/DB/Bot を起動し、ブラウザ API から2通投稿して、本物の PostgreSQL クエリでレベル 2 → 3 を確認します。Bot を別プロセスで起動・再起動するケースと、app の再起動でトークンを再利用するケースも実行します。保存先・接続先は手動起動中の app と分離しています。

`/admin` はまだ簡易画面です。DM / VC の模擬および Discord 全 API の互換は未実装です。
