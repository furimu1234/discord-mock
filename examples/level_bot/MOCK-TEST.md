# level_bot: upstream dev_container_ts_bot + embedded PostgreSQL

移植元: https://github.com/furimu1234/dev_container_ts_bot （MIT ライセンスは [LICENSE](LICENSE) に保存）

## 保持したもの

- `packages/bot/src/**` と `packages/db/src/**` の構成、実際の `events/leveling.ts`、`Container()`、`getLevel`・`createLeveling`・`updateLeveling`、Drizzle / `pg`。
- 元の `src/main.ts` も資料として保持。オリジナルの起動コードには未完成の `client.login('')` や移行スクリプトが残るため、デモ用に `src/local.ts` を追加。**デモ Bot に Fake DB は差し込まない**。
- Node 24 / pnpm 11 用 Dev Container を `.devcontainer/` に維持。元の manifest は `upstream.package.json` と `upstream.pnpm-workspace.yaml` に保存。

## 修正したバグ

- PostgreSQL の `userId` 列名が `server_id` と重複していたため `user_id` に修正
- Bot が人間のメッセージを無視していた `message.author.bot` 判定を修正
- `Container()` がメッセージごとに新しい `pg.Pool` を生成していた部分を1つのプールに集約
- `TOKEN` / `POST_URL` の評価タイミングを起動時に変更

## ブラウザから動作確認（推奨）

ルートで:

```sh
nix-shell
pnpm install
pnpm build
pnpm demo
```

`http://127.0.0.1:3000/test` を開き、ダミーユーザーを選んで投稿します。

`pnpm demo` は自動的に (1) インメモリ PGlite、(2) 127.0.0.1 に限った PostgreSQL ソケットサーバー、(3) Discord Mock REST/Gateway、(4) 標準の `discord.js` Bot を起動します。PGlite に `example.lvl` を作成し、通常の `POST_URL` DSN で元の Drizzle / pg に接続させます。実 DB サーバー・Docker は不要です。終了すると DB は消えます。

**元のレベリング Bot は返信を投稿しません。** ブラウザにはダミーユーザーのメッセージと Bot 接続状態が表示されます。Bot 側が `channel.send` を実行する場合、その REST POST は画面へ反映されます。

## E2E

```sh
pnpm sample:test
```

別の Mock/DB/Bot を起動し、ブラウザ API から2通投稿して、本物の PostgreSQL クエリでレベル 2 → 3 を確認します。接続先はテストごとに異なります。

`/admin` はまだ簡易画面です。DM / VC の模擬および Discord 全 API の互換は未実装です。
