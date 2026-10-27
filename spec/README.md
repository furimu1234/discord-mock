# Mock API 契約 (public Discord API shapes)

`apps/server/src/server.ts` は、現時点で次の部分的な REST / Gateway 互換ルートを実装しています。

- GET `/api/v10/gateway` / `/api/v10/gateway/bot`
- GET `/api/v10/users/@me` / `/api/v10/users/@me/guilds`
- GET `/api/v10/guilds/:id`, `/api/v10/guilds/:id/channels`, `/api/v10/channels/:id`
- GET/POST `/api/v10/channels/:id/messages`
- Gateway `/gateway`: Hello、Heartbeat/ACK、Identify、Ready、GuildCreate、Resume、Voice State Update（通知のみ）

Test-only `/_mock/state` と `/_mock/dispatch` は Mock 独自 API で管理者シークレットを要求します。
音声の RTP/UDP 互換、全イベント、Interaction API、DM・ユーザー権限などは未実装です。
Discord の公開 API 仕様だけを参考に独自実装し、非公開 API の解析は行いません。
