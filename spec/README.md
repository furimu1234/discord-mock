# Discord 互換・Mock 管理 API

Mock が現時点で独自実装した一部の公開 Discord API 形式:

- `GET /api/v10/gateway`, `GET /api/v10/gateway/bot`
- `GET /api/v10/users/@me`, `GET /api/v10/users/@me/guilds`
- `GET /api/v10/guilds/:id`, `GET /api/v10/guilds/:id/channels`, `GET /api/v10/channels/:id`
- `GET/POST /api/v10/channels/:id/messages`
- `POST /api/v10/interactions/:id/:token/callback` （一部の応答種別のみ）
- `GET/POST/PUT /api/v10/applications/:applicationId/commands` と Guild スコープの同ルート（引数なし CHAT_INPUT）
- Gateway: Hello / Heartbeat / Identify / Ready / GuildCreate / Resume / Voice State通知 / MESSAGE_CREATE / INTERACTION_CREATE

Mock 管理用エンドポイント（**Discord 公式 API ではない**）:

- `GET /_mock/state` — 状態確認
- `POST /_mock/dispatch` — 指定 Gateway イベント注入
- `POST /_mock/interaction` — ダミーユーザーによるコマンド/ボタン操作を疑似送信
- `GET /_mock/interactions/:id` — Bot の Interaction Callback 応答を確認

Mock 管理用は CLI で発行した `x-discord-mock-secret` ヘッダー必須。Discord 互換 REST は CLI の `mock_` Bot トークンのみ許可します。

現在は一部のデータ・プロトコル・イベントのみ。実 Voice / RTP 音声、DM、ロール・権限、完全なコマンド登録・キャッシュ同期、全 Discord REST の互換性は未実装です。

登録 JSON・エラー・ID・保存・ブラウザ実行主体・SDK 検証範囲は [commands.md](commands.md) を参照してください。

`/database` と `/_admin/session`・`/_admin/database/*` は、独立したローカルセッションを自動作成する読み取り専用の DB ビューです。管理キーの入力は不要です。契約・セッション・検索条件・制約は [database.md](database.md) を参照してください。

## ローカル起動設定

`pnpm app` は Web・Mock・PGlite、`pnpm bot` は `TOKEN` 環境変数を使うサンプル Bot を別々に起動します。`.discord-mock-data/credentials.json` は `{ "schemaVersion": 1, "token": "mock_..." }` 形式で、トークンがない場合だけ生成します。本番トークン・破損 JSON・未対応バージョンは拒否し、ファイルを上書きしません。認証情報は Mock 状態とは別に保存し、`/_mock/state` やブラウザ API では返しません。

app が起動中の接続先を `runtime.json`（`schemaVersion`、`url`、`postgresDsn`）へ原子的に書き出し、Bot が読み込みます。新しい資格情報と接続設定のファイルは所有者向けのファイル権限で作成します（POSIX では `0600`。Windows では ACL に従います）。ロックで同じ保存先の app とトークン JSON 更新の競合を拒否します。REST / Gateway の JSON・イベント形式、SDK の接続先差し替え方式は変更していません。

## 実装整理時の参照資料

2026-10-28 の TypeScript リファクタリングでは、既存の API 契約・対応範囲を維持し、プロトコル機能を追加していません。参照した公開仕様は [Gateway](https://docs.discord.com/developers/events/gateway)、[Message](https://docs.discord.com/developers/resources/message)、[Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)、SDK の公開設定は [discord.js 14.27.0 ClientOptions](https://discord.js.org/docs/packages/discord.js/14.27.0/ClientOptions:Interface) です。

同日に [Developer Terms Section 2](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)、[Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)、[Terms of Service](https://discord.com/terms)、[公式ドキュメントのライセンス](https://github.com/discord/discord-api-docs#license) を確認しました。独立起動・トークン JSON の追加時にも同じ一次資料を再確認しました。変更は独自のローカル起動・設定処理に限定し、公式の説明文・サンプルコードの転載や本番 Discord 通信を追加していません。この確認は互換サーバーの開発・配布に関する許諾や規約適合を保証するものではありません。
