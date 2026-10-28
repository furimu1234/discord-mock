# Create Message / Message Object（Discord API v10）

基準: [Discord公式 Message Resource](https://discord.com/developers/docs/resources/message)。
自宅・自己管理VPS向けループバックMockであり、本番Discord通信を行いません。

## Create Message JSON

`POST /api/v10/channels/{id}/messages`

| フィールド | 対応 |
|---|---|
| content | 最大2000文字 |
| embeds | 最大10個・合計6000文字、rich Embedのtitle/description/url/color/timestamp/author/footer/image/thumbnail/fields等 |
| nonce / enforce_nonce | 25文字以内、同一送信者・チャンネルの短期重複抑制 |
| tts | booleanをMessageへ反映 |
| allowed_mentions | parse/users/roles/replied_userを検証、明示メンションを解決 |
| message_reference | 返信/転送参照、referenced_message/message_snapshotsを生成 |
| components | コンポーネントJSONを保存（押下は未実装） |
| sticker_ids | 最大3件、sticker_itemsを返却 |
| attachments | JSONのメタデータを保存（実ファイル添付・配信は未対応） |
| flags | SUPPRESS_EMBEDS、SUPPRESS_NOTIFICATIONS、IS_VOICE_MESSAGE、IS_COMPONENTS_V2のビットを検証 |
| poll | JSONを保存（投票と終了処理は未対応） |
| shared_client_theme | JSONを保存 |

## Message Object

必須/通常: id, channel_id, guild_id?, author, content, timestamp, edited_timestamp,
tts, mention_everyone, mentions, mention_roles, attachments, embeds, pinned, type, flags。

条件付き: mention_channels, reactions, nonce, webhook_id, activity, application,
application_id, message_reference, referenced_message, message_snapshots,
interaction_metadata, interaction, thread, components, sticker_items, stickers,
position, role_subscription_data, resolved, poll, call, shared_client_theme。

JSONを受け取ることと、そのフィールドが持つDiscord側の全挙動を再現することは異なります。
メッセージの種類・発生経路に応じて任意項目を返却します。

## 未実装・制限

- バイナリ添付のmultipart/form-data、CDN配信、音声アップロード
- Poll投票・結果集計・締切、Stickerの実体
- コンポーネント押下などのInteraction全機能
- Webhook/スレッド/全リアクション・メッセージ編集/削除経路
- Discord本番と同等の全権限・レートリミット・エラー表現
