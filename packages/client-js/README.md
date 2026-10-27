# @discord-mock/client-js (preview)

テストハーネス向け JS クライアントの土台です。現段階では `createMockClient().health()` のみ提供します。
discord.js の REST/Gateway/Voice 接続先差し替え、コマンド、DM、VC 等の機能は **未実装**です。

ルートから `pnpm --filter @discord-mock/client-js test` で検証できます。

npm 公開は準備未完了のため `private: true` としています。公開する際はパッケージ名・名称使用権・Trusted Publisher 設定・互換性・規約適合を確認してください。
