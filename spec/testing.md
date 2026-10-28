# JS 自動テスト API（初版）

`@discord-mock/client-js/testing` の Node.js 所有者向け API。公開型は `packages/client-js/src/testing-types.ts` を Server と JS が共有する。Python の新 API は JS の仕様確定後に検討する。

`createTestEnvironment({ fixture?, now?, timeoutMs? })` は `127.0.0.1:0` で専用の Mock を起動する。fixture は既存の Mock JSON / `snapshot()` の結果で、読み込み時にコピー・検証する。省略時は既定の Bot・単一 Guild・Alice / Bob・general・@everyone を作る。テスト環境が生成する `mock_` トークンを `connect(client)` で使用し、`.env` や本番サービスを必要としない。URL・トークン・状態を外部へ送信しない。

## 操作

| API | 動作 |
| --- | --- |
| `users.create({id?, username})` | ダミーユーザーと Guild メンバーを同時に作成 |
| `channels.create({id?, name, type?, permissionOverwrites?})` | テキスト (0、既定) または VC (2) の定義を作成 |
| `roles.create({id?, name, permissions?, color?})` | ロール作成。権限は整数の文字列 / bigint、既定0 |
| 各コレクションの `get(id)`, `findByName(name)`, `list()` | 同じ環境内の既存データのコピーを同期取得。該当なしは undefined、同名複数はエラー |
| `members.get(userId)`, `list()` | Bot を含むメンバーと所属ロールをコピー取得 |
| `members.addRole(userId, roleId)`, `setRoles(userId, roleIds)` | 付与 / 置換。存在しない対象・重複・@everyone の明示付与を拒否 |
| `as(userOrId).sendMessage(channelId, content)` | 現在の正規ユーザー情報を解決して投稿 |
| `as(userOrId).runCommand(channelId, name, {timeoutMs?}?)` | 登録済みの引数なしコマンドを実行し、同じ Interaction ID の返信を待つ。名前の先頭に / は付けない |
| `commands.list()`, `waitFor(name, {timeoutMs?}?)` | 登録コマンドの取得・登録待ち |
| `messages.list(channelId)`, `waitFor(query, predicate?)` | メッセージ取得・待機。query は channelId と任意の authorId / afterId / interactionId / timeoutMs |
| `guild`, `snapshot()` | Guild / 永続化形式の状態のコピー |
| `connect(client)` | 既存 Client の公開 REST 設定をローカルに向け、Mock トークンで接続。同じインスタンスを返す |
| `reset()`, `close()` | 接続した Client の destroy を待ち、初期状態へ戻す / サーバーを終了 |

待機は既存データを検索してから状態変更イベントで再評価する。既存メッセージを除外したい場合は `afterId` を指定する。タイムアウトは実時間で既定3000ms、許容値1〜60000ms。reset / close は未完了の待機をエラーで終了し、リスナー・タイマーを解放する。reset には接続した Bot の切断が必要で、所有している Client は自動切断する。切断・接続待ちには3000msの上限を設け、ライブラリから process.exit は呼ばない。SDK の destroy 自体が停止できない独自実装では、その Client の後処理も利用側の責任になる。

## 共有する状態とイベント

Server の `MockRuntime.testing` と SDK の testing サブパスは同じ MockEnvironment の操作を呼ぶ。新しい無認証 HTTP 管理経路は設けない。UI・Bot REST・Gateway は同じユーザー / Guild / チャンネル / ロール / メッセージを参照する。管理画面の CRUD はこの変更では実装していない。

作成・変更時は `GUILD_MEMBER_ADD` / `CHANNEL_CREATE` / `GUILD_ROLE_CREATE` / `GUILD_MEMBER_UPDATE`、投稿時は `MESSAGE_CREATE` を配信する。初期 GUILD_CREATE と投稿・Interaction の member には実際の対象ユーザーと所属ロールを入れる。既存の raw 管理イベント注入は認証済み所有者向けの低レベル API として維持する。

ID は省略すると環境内で採番し、明示指定時は17〜20桁・符号なし64bit・重複なしを検証する。Guild ID と @everyone ID は同一とする。名前は空白だけ・制御文字・100文字超を拒否する。権限は64bit、色は0〜0xffffff、参照先は同じ Guild 内に存在する必要がある。取得オブジェクトの改変では状態を変更できない。

JSON には `version: 1` とメンバー情報 `members` を保存する。version のない旧形式は1として扱い、members がなければ既存ユーザーからロールなしの所属を補完する。未知の version / 不正な参照は起動エラーとし、元ファイルを上書きしない。新規 `createTestEnvironment()` はファイルへ自動保存しない。既存 Server の statePath がある場合は同じ状態をスナップショット化し、プロセス内の書き込みを直列化して一時ファイルから rename する。同じ statePath を別プロセスで共有する排他制御はこの API の対応範囲外であり、テストごとに専用の保存先を使う。

## 権限と制約

ユーザー操作はサーバーの共有処理で ViewChannel と SendMessages / UseApplicationCommands を検証する。ブラウザの状態取得でも閲覧不可のチャンネル・メッセージを除外する。@everyone → 所属ロール → チャンネル上書き（@everyone / ロール群 / 個人）の順で基本ビットを計算し、Administrator・Guild 所有者は全権限として扱う。この Mock の単一 Bot も全権限として扱う。新規の既定 @everyone は閲覧・投稿・コマンド実行を許可する。既存 JSON の権限値を読み込み時に昇格させない。

タイムアウトされたメンバー・スレッド・コマンド単位の権限・VC 操作権限などは未対応。VC 定義の作成は実音声テストを意味しない。DM・コマンド引数・defer 後の編集 / follow-up・ephemeral も対応範囲外。discord.js 14.27.0 を使い、初期キャッシュ / 接続後の更新 / 実ユーザーとロール / コマンド返信の対応付けを Vitest で検証する。Jest 用独自ランナー・matcher は実装せず、通常の非同期 API として使用する。

## 参照した公開仕様・条件

2026-10-28 に [Gateway Events](https://docs.discord.com/developers/events/gateway-events)、[Permissions](https://docs.discord.com/developers/topics/permissions)、[Developer Terms Section 2](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)、[Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)、[Terms of Service](https://discord.com/terms)、[公式資料のライセンス](https://github.com/discord/discord-api-docs#license) を確認した。公開フィールドと基本イベントの範囲を独自のダミー状態で実装し、本番のデータ・内部 API・公式クライアントの解析は使用しない。文章・コードは独自に作成し、公式資料の説明・コード例は転載しない。公開仕様の参照は、配布許諾や公式承認・完全互換の保証を意味しない。

## 起動中 app への実行内容の反映

`createTestEnvironment({reportTo: {baseUrl, name}})` は独立したテスト環境の表示用コピーをローカル app へ送る。`report({step?, status?})` で経過と結果を指定する。status は running / passed / failed / cancelled。`reportTo` 省略時は app と通信しない。`subscribe(listener)` は状態変更を購読し、返した関数で解除する。reporter はこれを利用して変更順に送信する。

表示先はループバック HTTP の origin に限定し、リダイレクトを拒否する。ローカル管理セッションと CSRF を使う。トークン・Interaction のシークレット・DSN・例外本文は送らず、スナップショットと明示したテスト名・経過・結果を送る。失敗を握りつぶさず report / close から通知する。未完了で close した実行は cancelled とする。結果確定後は更新しない。

app の `/tests` では実行一覧・経過・メッセージ・Embed とコマンド実行者を表示し、SSE で更新する。通常の app のドメイン状態や DB へマージせず、Bot にイベントを再配信しない。最大20実行・各100経過をメモリに保持し、20件に達したら完了済みの古い実行を除去する。すべて実行中なら429。各リクエストの上限は64KBで、表示用メッセージは許可したフィールドだけを投影する。app 再起動で結果を消去する。

管理 API は次のとおり。すべて既存の Host / Origin / Fetch Metadata 検証と管理認証を使用し、書き込みには管理 cookie + CSRF + JSON Content-Type を必須にする。テスト用ダミーユーザーの cookie ではアクセスできない。

| 経路 | 動作 |
| --- | --- |
| GET `/_admin/test-runs` | 新しい順の概要一覧 `{runs}` |
| POST `/_admin/test-runs` | `{name, step?, status?, snapshot}` を受けて実行を作成、201で概要を返す |
| GET `/_admin/test-runs/:id` | 概要 + steps / guild / messages の表示用データ |
| PUT `/_admin/test-runs/:id` | 同じ入力で更新。結果確定済みは409 |
| GET `/_admin/test-runs/events` | `changed` イベントの SSE。データは空オブジェクト、取得 API で再読込 |

概要は id / name / status / step / startedAt / updatedAt。実行 ID はサーバーで発行する UUID。日時はサーバーの実時間。Python の新テスト API は追加せず、共有 HTTP 契約の認証・表示コピー取得だけを回帰検証する。

## サンプル Bot のテスト構成

`pnpm bot:test` は `examples/level_bot/tests/bot/**/*.test.ts` を Vitest で実行する。機能ごとの TS ファイルを置くと同じコマンドで検出する。Web / Server / SDK のテストはこのコマンドに含めない。`pnpm sample:test` は `tests/integration/*.test.ts` の app / DB / プロセス起動の検証も行う。

共通の `tests/helpers/bot-test.ts` はテスト単位の fixture として実 Bot / DB / Mock を起動・終了する。本文は `bot.as(user).sendMessage(content)` / `.command(name)` と通常の expect を使う。`bot.levels.set/get` はサンプル固有のデータ準備 / 確認用。汎用 SDK の新 API ではない。HTTP ヘッダー・接続・後片付けは本文に含めない。Web 反映は既存の reportTo と管理セッションを使う。

登録関数は通常の Client を受け取り、公開 `Client.isReady()` で Ready 後であることを確認してから、既存のローカル REST 設定を検証する。呼出側へ Client<true> の型アサーションを要求しない。2026-10-28 に [discord.js 14.27.0 の公開 Client API](https://discord.js.org/docs/packages/discord.js/14.27.0/Client:Class#isReady) と、上記の公式規約を確認した。Mock のプロトコルや本番への接続経路は追加しない。
