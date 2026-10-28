# Discord Mock デスクトップ版（Electron）

同じ Mock Server を3つのウィンドウで起動します。

- Discord 風テスト画面（Webの /test と共通）
- 管理画面（ユーザー・ロール・チャンネル、ロール権限、チャンネルごとの権限上書き、Bot起動設定）
- Bot ターミナル（stdout と stderr を最大1000行分表示）

Web 版は従来どおり pnpm dev または CLI で起動できます。Webの /admin は CLI に表示された管理者シークレットでログインしてください。Electronでは管理者の HttpOnly cookie を管理画面専用セッションに設定し、テストウィンドウには渡しません。

## 開発起動

Node.js 24、pnpm 11、Git が必要です。ルートから以下を順番に実行します。

1. pnpm install --frozen-lockfile
2. pnpm --filter @discord-mock/web build
3. pnpm --filter @discord-mock/server build
4. npm install --prefix apps/desktop
5. pnpm desktop:build
6. pnpm desktop:dev

apps/desktop は既存の pnpm lockfile に影響させないため pnpm workspace から除外し、デスクトップ版の依存だけ npm で管理します。

## 配布物の作成

- Windows: pnpm desktop:dist:win → ポータブル exe
- macOS: pnpm desktop:dist:mac → .app フォルダー
- Linux: pnpm desktop:dist:linux → AppImage

生成先は release/desktop/ です。テストクライアントのディレクトリと同じ場所に配布物を置き、実行ファイルを開けます。macOS の .app はフォルダー全体がアプリです。各OS用バイナリは該当OS上でビルドする必要があります。GitHub Actions は実行ファイルを artifact に保存しますが、署名・公証やGitHub Release公開は自動実施しません。

## 管理画面からの Bot 起動

実行ファイル名（例: node）、引数（JSON 配列の例: ["dist/bot.js"]）、絶対パスの作業ディレクトリを入力して設定保存し、起動を押します。保存と起動は別操作です。再起動すると現在のBotを終了させてから保存済みコマンドで起動します。

コマンドは shell:false で直接起動されます。信頼できるテスト用Botだけを指定してください。子プロセスに DISCORD_MOCK_URL、DISCORD_MOCK_TOKEN、TOKEN が渡されます。ただしDiscord SDKの接続先差し替えには別途Mockアダプターが必要です。実Discord APIへの通信を OS レベルで禁止するものではありません。

MockデータはElectronの userData/local-mock/state.json、起動設定は userData/local-mock/bot-config.json に保存されます。管理APIは127.0.0.1に限定されます。保存したBot起動コマンドは次回も使用できますが、起動は管理画面からの手動操作です。

**制約:** このElectron起動方式では level_bot の PGlite / TestCaseRunner は同梱しません。PGliteベースの自動テストは従来どおり pnpm app / pnpm bot を使用してください。VC実音声・全Discord API互換・署名・公証・自動更新は未実装です。SaaS化・外部公開は行いません。
