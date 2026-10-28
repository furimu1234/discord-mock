# Application Command 登録とブラウザ実行

公開 [Application Commands](https://docs.discord.com/developers/interactions/application-commands) と [Interaction](https://docs.discord.com/developers/interactions/receiving-and-responding) の JSON を参照した独自実装です。対象は引数なしの `CHAT_INPUT`（`type: 1`）です。

## 対応 REST

すべて `Authorization: Bot <mock_...>` を必須とします。

| メソッド | パス（`/api/v10` 配下） | 動作 |
| --- | --- | --- |
| GET | `/applications/:applicationId/commands` | グローバルコマンドの一覧 |
| POST | 同上 | 同名コマンドを作成・更新。新規は 201、更新は 200 |
| PUT | 同上 | 一覧を置換。空配列で全削除。200 |
| GET / POST / PUT | `/applications/:applicationId/guilds/:guildId/commands` | Guild 単位で同じ操作 |

Application ID は Mock の `123456789000000001`、Guild は Mock 状態内の Guild に限定します。存在しない Application / Guild は 404、認証なしは 401、不正なコマンド定義は 400（`code: 50035`）です。単体コマンドの GET / PATCH / DELETE、登録権限の個別編集は未実装です。

入力は `name`（公開仕様の小文字・Unicode 命名規則、1〜32 文字）、`description`（1〜100 文字）、省略可能な `type: 1`・`options: []` です。非空 options、他のコマンド種別、未対応の権限制約や Guild で使えない contexts / integration_types は拒否します。各スコープ最大100件、同名の重複は拒否します。一括置換は全要素の検証後に反映し、同名更新では既存 ID を保持します。

応答は `id`・`application_id`・`type`・`name`・`description`・`options`・`version` を含み、Guild コマンドでは `guild_id` も返します。登録した一覧は Mock 状態の `commands` に保存し、`statePath` 指定時にはローカル JSON に永続化します。旧 JSON に `commands` がなければ空配列として読み込みます。不正な保存済みコマンドは起動エラーにします。

## ブラウザ独自 API

`GET /_ui/state` の `commands` は現在の Guild で使える登録済みコマンドです。グローバルと Guild の同名がある場合は Guild を優先します。登録更新は SSE `changed` で通知します。

`POST /_ui/interaction` は `channel_id` と `command_id` を受け取り、選択中のダミーユーザーを実行者にします。既存の `name` 指定も登録済みコマンドに限って受け付けます。Cookie と CSRF トークンが必要で、実行者 ID はリクエスト本文から取得しません。未登録コマンドや現在の Guild で使えない ID は 404、無効なテキストチャンネルは 400 です。`INTERACTION_CREATE.data.id` には登録 ID を使用します。管理用 `/_mock/interaction` は任意イベントを作る別のテスト経路として維持します。

## 返信の表示と Embed

`type: 4` のコマンド返信メッセージには `application_id`、`interaction_metadata`（`id`, `type: 2`, 実行時の `user`, `authorizing_integration_owners`）と、公開 Message 仕様で deprecated とされる `interaction`（`id`, `type: 2`, `name`, `user`）を付けます。コマンド名の表示には後者を使い、返信の上に「実行者 さんが /コマンド名 を使用しました」を表示します。実行者は Interaction 作成時に保存し、返信までのユーザー切替に影響されません。通常のメッセージ・ボタン返信にはコマンド表示を付けません。`statePath` 指定時は返信とともに JSON に保存し、再起動後も表示できます。Interaction のシークレットトークンは返信へ含めません。

フィールドは公開 [Message](https://docs.discord.com/developers/resources/message) の部分集合です。2026-10-27 に現行の上記公開仕様、Developer Terms / Policy、Terms of Service を参照しました。独自生成のローカルデータだけを扱い、公式 UI・コードや本番の応答は転用していません。

保存 JSON のコマンド実行情報が不正な場合は起動を失敗させ、既存ファイルを上書きしません。旧メッセージに実行情報がない場合は従来どおり表示します。

同じ Interaction への初期 Callback は1回だけ受理します。複数 SDK 接続から同時に届いた場合も、メッセージの保存・配信前に応答済み状態を確定し、2回目以降は HTTP 400 と `{code: 40060}` を返します。公開 [JSON error codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes#json) に基づく部分実装です。引数や内容が同じでも、別 ID のコマンド実行はそれぞれ返信できます。Web は送信中の重複 submit と Enter の key repeat を無視します。

この変更時にも現行の公開 Interaction 仕様・エラーコード、Developer Terms Section 2 / Developer Policy / Terms of Service、公式資料のライセンスを再確認し、独自のローカル状態処理とテストだけを変更しています。

`type: 4` の Callback と `POST /api/v10/channels/:channelId/messages` は `content` と `embeds` を共通の検証で受け付けます。`content` を省略した Embed のみの返信も保存・MESSAGE_CREATE 配信・ブラウザ表示・JSON 再読込に対応し、保存時の `content` は空文字列になります。

対応する Embed は `type: "rich"`（入力では省略可）、`title`、`description`、`color`、`fields: [{name, value, inline?}]`、`footer: {text}` の部分集合です。公開 [Embed 仕様](https://docs.discord.com/developers/resources/message#embed-object) を参照し、タイトル256文字、説明4096文字、footer2048文字、最大25フィールド（名前256文字・値1024文字）、最大10 Embed、合計6000文字を上限とします。色は 0〜0xffffff の整数です。Embed のテキストは前後の空白を除去し、空の Embed、型違い、制限超過、未対応フィールドは HTTP 400 / code 50035 とします。無効な Callback は応答済みとして消費しません。

画像・URL・動画・author・footer のアイコン・timestamp・リンクプレビュー・Markdown 表示は未対応です。ブラウザではすべての文字列を textContent で表示し、外部リソースを取得しません。入力にはテキストまたは対応 Embed の少なくとも1つが必要です。不正な保存済み Embed は起動エラーにし、JSON を上書きしません。これは Embed 全機能の互換を宣言するものではありません。

## サンプル Bot の TS コマンド自動登録

`pnpm bot` は `tsx` でソースを直接実行し、Ready 初期化時に `examples/level_bot/packages/bot/src/commands/` を再帰的に走査します。対象は `.ts` の実ファイルで、ローダー自身・`.d.ts`・リンク・隠しディレクトリ・node_modules を除外します。各モジュールは `data.toJSON()` と `execute` 関数を公開します。パス順に処理し、import、export 形式、定義生成、名前の重複、100件の上限、REST 登録の各エラーをファイル単位でスキップします。

各定義を Mock の POST 登録 API で検証した後、成功した定義だけを PUT で置換します。削除・失敗したファイルの古い登録を除去し、残った同名コマンドの ID は維持します。ログにはファイル名と失敗段階だけを出し、例外本文・スタック・リクエスト詳細は出しません。コマンドを追加・変更したら Bot の再起動で反映します。実行時の型検査やホットリロードは行わず、型検査には `pnpm check` を使用します。

これはサンプル Bot の起動処理であり、REST / Gateway の契約は変更しません。app は手動の `pnpm build` で生成した成果物を実行し、起動時にビルドしません。Bot が参照する `@ex/db` と JS アダプターは tsconfig の paths でソースへ向け、古い dist を読まないことをテストします。

## SDK 確認と制約

- JS: 実 `discord.js 14.27.0` の ClientReady、`application.commands.set/fetch`・`guild.commands.set/fetch`、ブラウザ → Interaction → `reply`、PGlite のレベル値を Embed のみで返す `/レベル確認` を検証。
- Python: 実 `discord.py 2.7.1` の `CommandTree.sync/fetch_commands` と REST の `channel.history` による Embed 読込を、既存の一時的な `mock_routes` の内側で検証。Gateway 経由の Python SDK コマンド実行はこのテストに含みません。
- ブラウザ: `/` で一覧、接頭辞で絞り込み、クリック・↑↓・Enter / Tab で補完、Esc で閉じる。補完後の Enter または送信ボタンで実行します。IME の確定 Enter は送信しません。
- コマンド引数・サブコマンド・SDK 向け autocomplete Interaction（type 4）・コマンド単位の権限設定・DM・音声は未対応です。基本のチャンネル権限とロールの扱いは [自動テスト API 契約](testing.md) に記載しています。この一覧 UI は登録コマンドの検索であり、Discord の全機能の互換を宣言しません。
- Ephemeral（flags 64）の返信は未対応として 400 で拒否し、公開チャンネルへ流しません。

JSON 応答は `Content-Type: application/json` で UTF-8 エンコードします。`/oauth2/applications/@me` の App 情報は Mock のユーザーと固定のダミーデータから構成します。`verify_key` はプレースホルダーであり、HTTP Interaction の署名検証を実装したものではありません。

2026-10-28 に [Developer Terms Section 2](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)、[Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)、[Terms of Service](https://discord.com/terms)、[公開資料のライセンス](https://github.com/discord/discord-api-docs#license) を再確認しました。説明とコードは独自に作成し、公式の文章・サンプルコード・実サービスの応答は転載していません。公開仕様の参照を、配布の許諾や公式承認の保証として扱いません。
