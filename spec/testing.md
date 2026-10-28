# JS 自動テスト API（初版）

インストール対象は npm パッケージ `dismock`。Client の公開入口を `dismock/client`、E2E テスト環境の公開入口を `dismock/e2e` とする。以前の `@discord-mock/client-js` / `@discord-mock/client-js/testing` から変更し、物理ディレクトリは `packages/client-js/` のまま維持する。npm 名は小文字に統一する。REST / Gateway / Voice の仕様と Python クライアントの名前は変更しない。

`dismock/e2e` の Node.js 所有者向け API。公開型は `packages/client-js/src/testing-types.ts` を Server と JS が共有する。Python の新 API は JS の仕様確定後に検討する。

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

利用側の起動ファイルから `runTestClient(import.meta.url, {bot, database?, extend?, root?, tsconfig?, name?, environment?, channel?})` を呼ぶ。ファイル名は固定せず、実行ファイルと `import.meta.url` の実パスが一致するときだけ CLI を起動する。import 時は設定登録だけを行う。`bot({url, token, databaseDsn?, onDisconnect?})` は既存 Bot のローカル接続を行い、`{close(), failures?}` を返す。Bot の `main.ts`・業務ロジックは変更しない。singleton を export する既存 Bot の再読込・DB接続終了など、Bot 固有の処理はこの起動ファイルで行う。

| 起動引数 | 動作 |
| --- | --- |
| なし | Mock・Web・任意の DB・Bot 子プロセスを起動。初回から生成したダミートークンを使用 |
| `--test [tests配下の.test.ts] [--testNamePattern パターン]` | 配布済み Vitest 設定でテスト実行。App がなければ単一の一時 DB を共有 |
| `--test-web` | 起動済み App へのレポートを必須にして全テスト実行 |
| `--bot` | ローカル接続設定と `mock_` トークンを検証して Bot 単体起動 |
| `--app` | 従来の初回トークン保存・次回からの Bot 自動起動 |

App の起動・DB・プロセス監視・ケース実行はライブラリ側へ移し、利用側の `src` と Vitest 設定ファイルを不要にする。プロジェクトルートは起動ファイルの祖先で `tests` と `package.json` のあるディレクトリを優先し、見つからなければ最寄りの `package.json` を使う。`root` / `tsconfig` の明示指定も可能。CLI からは任意の Vitest 設定・任意の OS コマンドを受け取らない。テストファイル引数は実パスを検証し、プロジェクトの `tests` の外や `.test.ts` 以外を拒否する。

`database: {sql?}` を指定すると PGlite とループバック限定・動的ポートの TCP リスナーを起動する。SQL とスキーマは Bot 側が持ち、ライブラリにレベル Bot 固有のテーブル定義は含めない。App 稼働中は同じ DB を通常 Bot と全 UT が共有し、ケース間で初期化しない。App なしでは Vitest globalSetup が DB を1つ所有して終了時に閉じる。DB不要の Bot では database を省略する。PGlite・socket・TypeScript 起動用 tsx は optionalDependencies とし、これらの機能を使う場合だけ読み込む。テスト実行には利用側の optional peer Vitest 5 が必要。

App の `.discord-mock-data/runtime.json` は `schemaVersion: 1`、ループバックの `url` と任意の `postgresDsn` を持つ。DSN の外部ホスト・接続先を上書きするクエリパラメーターを拒否する。接続設定は権限0600の一時ファイルを rename して保存し、App / Bot の排他ロックと終了処理を維持する。既定の待受先は127.0.0.1で、ポート・保存先・JSON状態パスは既存の環境変数から指定する。終了時に Bot 子プロセス・テスト・Mock・DB を閉じ、接続設定とロックを除去する。直接実行の CLI だけがシグナルとプロセス終了を扱い、createTestEnvironment やプログラム用 startApp は process.exit を呼ばない。

プログラムからの起動・読込・DB検査は `dismock/runtime` の `startApp({entry, ...})` / `loadTestClient(entry)` としても公開する。Bot 単体やテスト fixture が重いケース収集用 TypeScript パーサーを常時読み込まないよう、App runtime を遅延ロードする。任意名の起動ファイル、ファイル名変更後の実行、利用側の src・helpers・integration・Vitest 設定がない npm インストール環境を実テストで検証する。Discord プロトコルと Python API は変更しない。

`pnpm bot:test` / `pnpm sample:test` は `examples/level_bot/tests/**/*.test.ts` を Vitest で実行する。`tests` 直下・任意のサブフォルダーを同じコマンドで検出する。利用側にはテストケースだけを置き、helpers / integration は不要とする。app / DB / プロセス起動の統合テストは `packages/client-js/tests/level-bot/*.node.test.ts` へ移し、`pnpm --filter dismock test:integration` とライブラリの通常の test で検証する。

共通 fixture は `dismock/e2e` の `test` / `expect` / `describe` として提供する。`configureE2E({start, extend?, environment?, channel?})` を既存のテスト用 Bot アダプターで一度だけ呼び、Bot 固有の起動・終了と検証 API を登録する。テストのコンテキストは `{ bot, actor }` とし、`actor` に対象ユーザーの全情報（`id`・`username` など）と `sendMessage(content)` / `command(name)` をまとめる。別の `user` は渡さない。`users: { ids: [...] }` では指定順に対象ユーザーの actor を作成して本文を実行する。標準 bot は mock / guild / channel / users / channels / roles / messages() / as(user) を提供する。extend は標準名を上書きできない。`bot.levels.set/get` はサンプルのアダプターに置き、汎用ライブラリへレベル DB のスキーマや Drizzle 処理を埋め込まない。独自 API の型は公開の `BotTestExtensions` を宣言マージする。HTTP ヘッダー・接続・後片付けは本文に含めない。Web 反映は既存の reportTo と管理セッションを使う。

`defineE2EConfig({setup, globalSetup?, runtimeFile?, root?, requireWeb?, resolve?})` は tests 配下の再帰検索と配布済みの Vitest setup を設定する。Vitest は optional peer とし、低レベルの createTestEnvironment / Node.js Bot アダプターの import 時には読み込まない。setup はプロジェクト所有者のローカル設定で指定し、ブラウザからファイルパスを受け取らない。`createSharedDatabaseSetup(startDatabase)` は既存の DB 起動関数を Vitest globalSetup として使い、実行全体で1つの DB を所有して終了時に閉じる。App がある場合は runtimeFile のループバック URL / PostgreSQL DSN を検証し、App の DB を再利用する。ケース間で DB を初期化しない。

`dismock/e2e/runner` の `LocalTestCaseRunner(origin, {root?, testsDir?, configFile?})` は TypeScript AST による静的ケース収集を利用側から取り除く。tests の相対パスとケース番号で ID を作り、同名ファイルを別ディレクトリとして区別する。シンボリックリンクと隠しディレクトリは追跡せず、プロジェクト外の testsDir を拒否する。HTTP の ID は再収集した登録済みケースと一致する場合だけ受け付け、引数配列で Vitest を起動する。公開 API の管理認証・CSRF・ブラウザ選択ユーザーの境界は変更しない。配布物にはケース解析用 TypeScript とそのライセンス・第三者表示を同梱する。

2026-10-28 に Vitest の公開 [fixture API](https://vitest.dev/guide/test-context.html)、[setupFiles](https://vitest.dev/config/setupfiles.html)、[globalSetup](https://vitest.dev/config/globalsetup.html)、[include](https://vitest.dev/config/include.html) を確認した。Vitest 5.0.5 と npm 配布物を使い、helpers/integration のない別プロジェクトの tests 直下・任意階層・Web 個別実行を検証する。Discord プロトコルや Python API は追加しない。

登録関数は通常の Client を受け取り、公開 `Client.isReady()` で Ready 後であることを確認してから、既存のローカル REST 設定を検証する。呼出側へ Client<true> の型アサーションを要求しない。2026-10-28 に [discord.js 14.27.0 の公開 Client API](https://discord.js.org/docs/packages/discord.js/14.27.0/Client:Class#isReady) と、上記の公式規約を確認した。Mock のプロトコルや本番への接続経路は追加しない。

## 既存 Bot の起動関数をラップする JS API

`Client(client, main, {baseUrl?})` は `(mockToken) => Promise<mainの戻り値>` を返す。Bot 本文を変更せず、公開 `rest.options.api` とインスタンスの公開 `login()` を利用する。`main(client, connect)` と引数なしの `main()` の両方を受け付ける。起動関数が行う login と connect は単一の接続にまとめ、元の環境変数の値ではなく引数のダミートークンを SDK に渡す。URL はループバック HTTP の origin、トークンは `mock_` に限定する。無効な入力では main を実行しない。

接続前に登録済みの `clientReady` リスナーは Node.js の公開 `rawListeners` / `on` / `once` / `removeListener` で追跡し、イベントの発火と返された Promise の完了を待つ。login が Ready より先に解決しても待機を省略しない。登録順・this・引数・once の消費を維持し、起動終了時に残存リスナーと元の login のプロパティ属性を復元する。同じ Client の並行起動を拒否する。起動失敗時は Client を切断する。稼働中の REST 通信は引き続きローカルへ送る。main や Ready が起動する非同期処理は、その関数が返す Promise の範囲だけを追跡する。タイムアウトは利用先のテストランナーで設定する。

モジュール import 時点での自動ログイン、別の REST インスタンス、Voice などの通信は対象外であり、全 Bot の変更不要を保証しない。新たな Discord プロトコル互換や Python API は追加しない。サンプルでは Bot の singleton モジュールをケースごとに別のクエリで import し、DB だけを共有する。npm pack の tarball を別プロジェクトに npm install し、公開 exports・型定義・既存 Bot の接続と返信を検証する。

2026-10-28 に上記 Developer Terms / Developer Policy / Terms of Service / 公式資料ライセンス、[discord.js の公開 RESTOptions.api](https://discord.js.org/docs/packages/rest/2.6.0/RESTOptions:Interface#api)、[Node EventEmitter の公開 API](https://nodejs.org/api/events.html#emitterrawlistenerseventname)、[discord.js 14.27.0 の Apache-2.0 ライセンス](https://github.com/discordjs/discord.js/blob/14.27.0/LICENSE) を確認した。変更は利用者の Bot をローカルで起動する独自のラッパーとテストに限定し、公式コードの複製・本番データの取得・非公開 API の利用は追加しない。パッケージには SDK 自体を同梱しない。この確認を公開配布の許諾や公式承認の保証として扱わず、npm 公開の既存の明示的な有効化条件を維持する。
