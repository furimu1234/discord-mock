# ブラウザのメッセージリンク・編集・削除

## ローカルURL

通常のチャットは `/#channel={channelId}&message={messageId}`、テスト結果は `/test#channel={channelId}&message={messageId}&run={runId}` を使用する。ホストとポートは現在のAppと同じ。実行IDを含め、異なるテストでメッセージIDが重なっても区別する。本番DiscordへのURL・トークン・管理キーは発行しない。

リンクを開いてもログインユーザーは変更しない。閲覧可能なメッセージだけを取得し、チャンネルを切り替えて対象を中央へスクロールする。移動先の背景は移動から3秒間だけ強調し、その後は通常へ戻す。SSEによる再描画では強調時間を延長せず、解除後に復活させない。再度移動した場合はその操作から3秒間強調する。存在しない・削除済み・閲覧不可のリンクはエラー表示する。リンク移動後は通常のSSE再取得でもチャットとログのスクロール位置を維持する。新しいテストの起動・実行中の進捗更新ではリンク閲覧を解除し、両方を同じ描画で末尾へスクロールする。新しい投稿が別チャンネルならそのチャンネルへ切り替える。CLIからの起動や、完了状態で一覧へ届いた新規実行でも追従を再開する。実行ログは、その実行の閲覧可能な最初のメッセージ（timestamp順）へ移動する。投稿がまだないログにはリンクを付けない。

右クリックメニューのリンクコピーは、表示中のメッセージについて編集・削除権限や送信者との一致を要求しない。コピーしたURL自体は閲覧権限を付与しない。

## Mock独自のブラウザAPI

いずれも `discord_mock_session` Cookieを必要とする。PATCH・DELETEは `x-discord-mock-csrf` も必須。実行者はセッションの選択ユーザーから取得し、bodyのuser_id等は権限判定に使わない。

| メソッド・パス | 動作 |
| --- | --- |
| `GET /_ui/messages/{channelId}/{messageId}` | 閲覧できるメッセージとcanEdit/canDeleteを取得 |
| `PATCH /_ui/messages/{channelId}/{messageId}` | JSON `{content: string}` で自分の本文のみ編集。上限2000文字。編集時刻を記録 |
| `DELETE /_ui/messages/{channelId}/{messageId}` | 自分の投稿、またはMANAGE_MESSAGESが有効なチャンネルの投稿を削除。200 `{deleted:true}` |
| `GET /_ui/test-runs/{runId}` | 選択ユーザーに閲覧可能なチャンネル・メッセージだけを含む表示用実行結果。DBスナップショットは含まない |

メッセージAPIの任意の `?runId={UUID}` はテスト結果を指定する。省略時は通常Mockを操作する。ブラウザの管理セッション・管理者CSRFをユーザー操作の代わりとして受け付けない。

エラーは400（入力不正）、401（セッションなし）、403（権限・CSRF不足）、404（メッセージ・実行なし）。本文はtextContentで表示し、HTMLとして解釈しない。削除は確認画面で確定する。

## 権限と保存

閲覧・編集・削除にはVIEW_CHANNELが必要。本文編集は送信者本人のみ。削除は本人またはMANAGE_MESSAGES（`1 << 13`、8192）を持つユーザー。既存のロール合算・チャンネル上書き・Administrator・Guild所有者の判定を共有する。通常Mockと同じGuildのテスト結果では、Appの現在のロール・所属・チャンネル上書きを使い、実行後のロール付与や閲覧制限も反映する。UT専用チャンネルは報告されたチャンネル上書きを使う。異なるGuildのテスト結果では報告されたMockの権限状態を使う。

通常Mockの変更はJSONへ保存し、MESSAGE_UPDATE / MESSAGE_DELETEをローカルGatewayへ配信する。テスト結果はApp内の表示用コピーを変更し、後続の進捗報告でも編集・削除が戻らないよう保持する。テスト対象の実行中Botへは再配信しない。テスト履歴はApp再起動または保持数上限による除去で失効する。通常MockのJSONへテスト結果を混入させない。

これはブラウザ独自APIであり、Discord RESTのPATCH/DELETE互換エンドポイントを実装したことを意味しない。

## 参照と確認記録（2026-10-28）

権限と本文編集・削除の条件は [公開Permissions仕様](https://docs.discord.com/developers/topics/permissions)、[Edit Message](https://docs.discord.com/developers/resources/message#edit-message)、[Delete Message](https://docs.discord.com/developers/resources/message#delete-message) を参照して独自実装した。説明文・コード例・公式UIの転載は行わない。

[Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)、[Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)、[利用規約](https://discord.com/terms)、[公式ドキュメントのライセンス](https://github.com/discord/discord-api-docs#license) を確認した。公開された権限仕様に基づくローカルのダミーデータ操作のみを追加し、本番サービスのAPI・データ・ソフトウェアを取得・複製しない。Discord公認・規約適合保証は表明しない。
