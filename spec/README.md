# Discord 互換・Mock 管理 API

Mock が現時点で独自実装した一部の公開 Discord API 形式:

- `GET /api/v10/gateway`, `GET /api/v10/gateway/bot`
- `GET /api/v10/users/@me`, `GET /api/v10/users/@me/guilds`
- `GET /api/v10/guilds/:id`, `GET /api/v10/guilds/:id/channels`, `GET /api/v10/channels/:id`
- `GET/POST /api/v10/channels/:id/messages`
- `POST /api/v10/interactions/:id/:token/callback` （一部の応答種別のみ）
- Gateway: Hello / Heartbeat / Identify / Ready / GuildCreate / Resume / Voice State通知 / MESSAGE_CREATE / INTERACTION_CREATE

Mock 管理用エンドポイント（**Discord 公式 API ではない**）:

- `GET /_mock/state` — 状態確認
- `POST /_mock/dispatch` — 指定 Gateway イベント注入
- `POST /_mock/interaction` — ダミーユーザーによるコマンド/ボタン操作を疑似送信
- `GET /_mock/interactions/:id` — Bot の Interaction Callback 応答を確認

Mock 管理用は CLI で発行した `x-discord-mock-secret` ヘッダー必須。Discord 互換 REST は CLI の `mock_` Bot トークンのみ許可します。

現在は一部のデータ・プロトコル・イベントのみ。実 Voice / RTP 音声、DM、ロール・権限、完全なコマンド登録・キャッシュ同期、全 Discord REST の互換性は未実装です。
