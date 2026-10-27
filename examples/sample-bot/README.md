# TypeScript サンプル Bot

`discord.js` の通常の `Client` と `@discord-mock/client-js` を使った、**ローカル Discord Mock 専用**の最小 Bot です。テスト用ダミーユーザーから `/ping` を受けると `Pong! 🦈` を返します。

## 自動 E2E テスト（推奨）

初回のみルートディレクトリで `pnpm install`、変更時には明示的に `pnpm build` を実行します。

```sh
pnpm build
pnpm sample:test
```

テストは同じプロセスで Mock Server を**空きポート**に起動し、実際の discord.js Client を接続し、`/_mock/interaction` で `/ping` イベントを発火して `Pong! 🦈` のコールバックを確認します。**実 Discord のトークン・サーバーは使いません**。テストは終了時に Bot と Mock Server を停止します。

## 2 つのターミナルで手動実行

ターミナル 1:

```sh
pnpm dev
```

CLI が表示する `mock_` トークンと管理用シークレットを確認してください。

ターミナル 2（Linux / macOS / NixOS、`nix-shell` に入っている場合）:

```sh
export DISCORD_MOCK_URL=http://127.0.0.1:3000
export DISCORD_MOCK_TOKEN=mock_発行されたテストトークン
pnpm sample:bot
```

Windows PowerShell:

```powershell
$env:DISCORD_MOCK_URL = "http://127.0.0.1:3000"
$env:DISCORD_MOCK_TOKEN = "mock_発行されたテストトークン"
pnpm sample:bot
```

Bot が接続したら、**さらに別のターミナル**で管理用シークレットを使って `/_mock/interaction` に `{"name":"ping"}` を POST し、応答を `/_mock/interactions/:id` から取得できます。詳細はルート [README](../../README.md) を参照してください。

`/test`・`/admin` はまだプレビューで、Web からコマンドを押して発火する UI は未実装です。**現段階のテスト入口は `pnpm sample:test` と Mock 管理 API** です。
