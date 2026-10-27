# dev_container_ts_bot を利用した Mock E2E

移植元: https://github.com/furimu1234/dev_container_ts_bot
元のライセンス: [MIT](LICENSE)

## ディレクトリ構成

元の `packages/bot/src/**`、`packages/db/src/**` と `devcontainer` 設定、Dockerfile、TSConfig、LICENSE などを `examples/dev-container-ts-bot/` に取り込みました。
モノレポ内のパッケージ名 `@ex/bot` と `@ex/db`、実際の `leveling.ts` / Drizzle データアクセス関数は維持しています。

### 差分（互換性・テスト用）

- パッケージ定義・ビルド方法を親 pnpm 11 workspace / Node.js 24 に合わせました。
- `src/env.ts` は変数の評価を遅延し、テスト時に本番用 `TOKEN` / `POST_URL` を要求しないようにしました。
- `schema.ts` の `userId` の PostgreSQL 列名が誤って `server_id` だったため、`user_id` に修正しました。
- `events/leveling.ts` の Bot ユーザーのみ対象になっていた判定を、通常のダミーユーザーを対象とするよう修正しました（元の初回メッセージはレベル2になります）。
- `src/mock.ts`・`src/runMock.ts` を**追加**し、オリジナルのイベントハンドラーと DB 関数に、テスト専用のインメモリ DB アダプターを接続します。Mock 実行時は実際の PostgreSQL を使いません。
- 元の `src/main.ts` はそのまま同梱していますが、移植元に本番ログインと DB 初期化の未完成箇所があり、**本テストではこの本番エントリーポイントを起動しません**。実行するのは移植元のイベント・DB 処理を使う Mock 専用の Bot です。

## 使用方法

ルートから:

```sh
nix-shell
pnpm install
pnpm build
pnpm sample:test
```

`pnpm sample:test` はテスト内でローカル Mock Server を起動し、実際の discord.js `Client` を接続します。
`/_mock/dispatch` で送信したダミーユーザーの `MESSAGE_CREATE` が元の `leveling.ts` に届き、元の `getLevel` / `createLeveling` / `updateLeveling` を使ってメモリ上のレベル値が更新されることを確認します。

このテンプレートには元々実用的なスラッシュコマンドの実装がないため、**旧サンプルの `/ping` の代わりにレベリング動作を検証します。** Voice や DB 実サーバーの統合テストは含みません。

起動を手動で分ける場合:

```sh
# ターミナル1：Mock Server
pnpm dev

# ターミナル2：上の CLI が表示したトークンを指定
export DISCORD_MOCK_URL=http://127.0.0.1:3000
export DISCORD_MOCK_TOKEN=mock_発行されたトークン
pnpm sample:bot
```

ダミーユーザーのイベント送信は `/_mock/dispatch` と管理用シークレットを使います。現段階ではブラウザ上のダミーユーザー操作 UI は未実装です。

移植元の `.devcontainer/` は **Node.js 24 / pnpm 11 に更新**しました。VS Code の Dev Containers で `examples/dev-container-ts-bot/` を開くと、ワークスペースは外側の `discord-mock` ルートをマウントして使う構成です。初回の `pnpm install` は Dev Container 作成時に行いますが、`pnpm build` は引き続き手動です。PostgreSQL コンテナは従来どおり起動しますが、`pnpm sample:test` は DB サーバーに依存しません。**Dev Container 自体の Docker 起動検証は CI では行っていません。**

NixOS の場合は従来どおりルートの `shell.nix` を使えば、Docker / PostgreSQL なしで E2E を実行できます。
