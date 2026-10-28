# レベル Bot のローカルテスト

`packages/bot/src/main.ts` は既存の Bot 本文です。Mock を使うために変更せず、`packages/bot/src/testClient.ts` から npm パッケージの `disMock.Client(client, main, { baseUrl })` で起動します。Client とイベント登録はケースごとに分離し、通常 Bot とテストは同じ PGlite を使います。

開発シェルで依存をインストールし、明示的にビルドしてから実行します。

```sh
pnpm install
pnpm build
pnpm bot:test       # CLIでUTを実行
pnpm app           # 管理画面・テスト画面
pnpm bot           # 起動済みAppへUT結果を表示
pnpm bot:client    # 起動済みAppへBot単体を接続
```

起動処理は `dismock` にまとめています。リポジトリ直下から次のファイルを直接実行すれば、初回から Mock・画面・PGlite・Bot がまとめて起動します。起動ファイル名は任意で、別名に変えても `runTestClient(import.meta.url, ...)` が実行元を判定します。

```sh
pnpm --dir examples/level_bot exec tsx --tsconfig packages/bot/tsconfig.json packages/bot/src/testClient.ts
# CLIでテストだけ実行する場合は、末尾に --test を付ける
```

`tests/bot/leveling.test.ts` では、ダミーユーザーの投稿から実際の Bot イベントと DB 更新を検証します。App がない CLI 実行では Vitest 全体で単一の一時 PGlite を共有します。DB はケースごとに初期化しません。

テストを書くときは `dismock/e2e` から `test`・`expect`・`describe` を import し、`tests/**/*.test.ts` を追加するだけです。`tests/bot` は任意の名前に変更でき、`tests` 直下も使えます。準備・後片付け・ユーザー選択・Web表示・DB起動はライブラリへ移しました。Bot 固有の接続・DBスキーマ・検証 API は `testClient.ts` にまとめています。`main.ts` の変更は不要です。利用側の `src` と Vitest 設定ファイルも不要になりました。

`tests/helpers` と `tests/integration` は利用側から削除しました。ライブラリ自身の統合テストは `packages/client-js/tests/level-bot/` にあり、`pnpm --filter dismock test:integration` で実行します。

別の Bot への導入方法と npm 配布物のインストール方法は [JS クライアント](../../packages/client-js/README.md) を参照してください。実 Discord のトークンは使いません。利用先は本人管理の PC / VPS に限定します。
