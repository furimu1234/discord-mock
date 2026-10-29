# Discord Mock デスクトップ版（Electron）

管理画面とチャットを1つのメインウィンドウで切り替えます。起動時は管理画面が開きます。

- メインウィンドウ: 管理画面のチャットリンクで `/test` へ、チャットの **ADMIN** で管理画面へ切り替えます。ユーザー・ロール・チャンネル、ロール権限、チャンネルごとの権限上書き、Bot起動設定を管理できます。
- Bot ターミナル: 色付きログを最大1000行分、別ウィンドウに表示します。出力元・時刻・Botの起動状態を表示し、検索、stdout / stderr / system の絞り込み、コピー、表示のクリア、自動スクロールの切り替えができます。

Web 版は従来どおり pnpm dev または CLI で起動できます。ブラウザの **ADMIN** を押すと同じタブの `/admin` に遷移します。CLI に表示された管理者シークレットでログインしてください。Electronでは管理画面とチャットに別々の WebContentsView / セッションを使い、管理者の HttpOnly cookie と Bot 操作用 preload / IPC は管理画面だけに付与します。同じウィンドウ内で切り替えてもチャットには管理権限を渡しません。

## ウィンドウの配置とサイズ

Mock画面・BotターミナルはOSの枠を非表示にしています。上部の細いバーをドラッグすると移動でき、右上から最小化・最大化・閉じる操作ができます。四辺と四隅の見えない領域をドラッグすると8方向にサイズを変更できます。内容もサイズに追従し、チャット・実行ログ・ターミナルは各領域内でスクロールします。

Mock画面をクリックすると「Mock画面 → ターミナル → 他のウィンドウ」、ターミナルをクリックすると「ターミナル → Mock画面 → 他のウィンドウ」の順に並びます。重なっている場合も、クリックした側が先頭、もう片方がそのすぐ後ろになります。入力フォーカスはクリックした画面に残ります。最小化・非表示にした画面はその状態を維持し、閉じたターミナルは再表示しません。他のアプリを選ぶと、そのアプリを通常どおり前面で使えます。

WSLgではWindows PowerShellを1プロセス起動し、Windowsの公開API [`SetWindowPos`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos) で選択中の画面の直後へ相手を配置します。位置・サイズ・フォーカス・常に最前面の属性は変更しません。WSLgが古い並び順を再送する間は最大200msだけ確定を確認し、途中で他アプリへ切り替えた場合や相手が最小化・非表示になった場合は処理を打ち切ります。

WSLのWindows実行連携と `powershell.exe` が利用できる必要があります。通信はローカルの標準入出力によるJSONのみで、システム設定は変更しません。管理・チャットのタイトル変更は同じ画面として扱い、同名の別インスタンスが複数ある場合は取り違えを防ぐため配置をスキップします。通常のWindows・macOS・LinuxではElectronの [`moveTop()`](https://www.electronjs.org/docs/latest/api/base-window#winmovetop) を使用します。

2026-10-30（日本時間）、WSLg 1.0.71で「別のウィンドウで相手を隠す → Mockまたはターミナルをクリック」の両方向を、Windows側の実際の重なり順とフォーカスから検証しました。タイトルが処理中に変わるケース、および `./run-nixos.sh` から起動した配布版AppImageでも確認しています。Windows側で最小化・非表示の維持も確認しました。前面表示の連動、最小化・非表示の維持、連動解除、素早い画面切り替えは自動単体テストでも検証しています。

管理画面の **ウィンドウ** で、Mock画面とターミナルそれぞれの起動先を選び、**起動先を保存** を押します。「最後に使ったディスプレイ」「メインディスプレイ」「指定ディスプレイ」から選べます。**Mock画面を移動** / **ターミナルを移動** は現在のウィンドウだけに反映し、起動先の設定は変更しません。閉じたターミナルはアプリの再起動で開きます。

ディスプレイごとの最後の位置・通常サイズ・最大化状態を両ウィンドウで別々に自動保存します。保存先はElectronのユーザーデータ内の `local-mock/window-layout.json`（version 1）です。作業領域からの相対座標を使い、解像度・拡大率の変更時は表示範囲へ補正します。指定画面が未接続なら最後に使った接続中の画面、またはメイン画面を使い、未接続画面の履歴は残します。不正な保存ファイルは起動エラーとして表示し、黙って初期化しません。

Linux / WSLでは `DISPLAY` が利用でき、`--ozone-platform` の明示指定がなければX11を使います。Waylandではアプリによるグローバル座標の指定・取得が制限されるため、ディスプレイへの移動・位置保存・独自のリサイズ操作は無効です。ウィンドウ管理はコンポジターに従います。位置の復元が必要な場合はX11で起動してください。明示的な `--ozone-platform=wayland` は尊重します。[ElectronのWaylandでの制約](https://www.electronjs.org/docs/latest/api/base-window#new-basewindowoptions)

ウィンドウ操作用の限定IPCはローカルの操作バーとターミナルだけに渡します。起動先の設定は管理画面専用で、チャットや通常のブラウザには操作権限を渡しません。

2026-10-29、WSL2 / NixOSの3ディスプレイで両ウィンドウの移動・画面別履歴・別ディスプレイへの再起動復元・最大化の復元を確認しました。650×450でもチャット・管理画面・ターミナルを確認し、Playwrightでログ180行の表示・リサイズ・スクロール・検索を検証しています。このWSLg環境では最小化要求後の状態通知を取得できなかったため、「最大化後に最小化して終了」の状態保持は自動単体テストで検証しています。Windows / macOSの実画面は未検証です。

## 開発起動

Node.js 24、pnpm 11、Git が必要です。ルートから以下を順番に実行します。

1. pnpm install --frozen-lockfile
2. pnpm build:web
3. npm install --prefix apps/desktop
4. pnpm desktop:build
5. pnpm desktop:dev

apps/desktop は既存の pnpm lockfile に影響させないため pnpm workspace から除外し、デスクトップ版の依存だけ npm で管理します。

画面遷移の許可範囲と Bot 起動設定の検証は `pnpm desktop:test`、Desktop の型チェックは `npm --prefix apps/desktop run typecheck` で実行できます。

### ターミナルの色と表示

BotのANSI SGRを描画し、16色・256色・RGB、文字色・背景色、太字・薄字・斜体・下線などを保持します。分割されたANSIシーケンスとUTF-8を出力元ごとに処理します。色の自動判定をするロガーには `FORCE_COLOR=3` を渡しますが、利用者が指定した `FORCE_COLOR` / `NO_COLOR` は優先します。出力がパイプの場合に色を抑制し、これらの環境変数にも対応しないロガーは、ロガー側の色設定が必要です。

これはBotの出力を閲覧するログコンソールです。対話型シェルや完全なVT端末のエミュレーターではありません。色は [xterm の公開SGR仕様](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html) を参照した独自処理で描画し、HTMLとしてログを解釈しません。OSCのリンク・クリップボード操作やカーソル制御は実行しません。コピーは表示中のログを制御文字のないテキストにします。長大な1行は16,384文字まで表示し、ログのクリアは画面表示だけに適用します。

検索は `Ctrl+F` / `⌘F` で選択できます。自動スクロールをオフにした場合や過去のログへスクロールした場合もログの受信は続き、**新しいログ** ボタンで末尾へ戻れます。

### WSL2 / NixOS で起動する

ビルド済みのアプリは、リポジトリ直下から次のコマンドで起動できます。WSL2 では WSLg が必要です。

```sh
./run-nixos.sh
```

`release/desktop` にある Linux AppImage を選び、デスクトップ用の Nix シェル、日本語フォント、`ELECTRON_RUN_AS_NODE` の解除をまとめて設定します。リポジトリ以外の作業ディレクトリからスクリプトを絶対パスで実行することもできます。

別の場所へコピーした AppImage を起動するときは、パスを指定します。空白を含むパスは引用符で囲んでください。

```sh
./run-nixos.sh ./examples/level_bot/packages/bot/src/discord-mock-0.1.0-linux-x86_64.AppImage
./run-nixos.sh "/path with spaces/discord-mock.AppImage"
```

AppImage がない場合、または候補が複数ある場合は理由を表示して終了します。ビルドや依存インストールは自動実行しません。`./run-nixos.sh --help` で使い方を表示できます。AppImage の後ろに指定した引数は、そのままアプリへ渡します。

ソースから開発起動するときは、デスクトップ用の開発シェルに入ります。

```sh
nix-shell --arg desktop true
pnpm install --frozen-lockfile
pnpm build:web
npm install --prefix apps/desktop
pnpm desktop:build
pnpm desktop:dev
```

通常の `nix-shell` に加え、Nixpkgs の Electron 43・appimage-run と日本語・絵文字用 Fontconfig をこのシェル内だけで使います。npm が取得する汎用 Linux バイナリの代わりに、公式の `ELECTRON_OVERRIDE_DIST_PATH` で Nix の実行ファイルを指定します。Electron の追加ダウンロードは省略します。システム設定やグローバルインストールは不要です。WSLg の `DISPLAY` / `WAYLAND_DISPLAY` を引き継ぎ、Chromium の sandbox は有効なまま起動します。

AppImage に日本語フォントは同梱していません。フォントを持たない NixOS / WSL の環境で `appimage-run` だけを使うと文字が四角になるため、このシェルの `FONTCONFIG_FILE` を引き継いで起動します。アプリの実行ファイルは指定した AppImage 内のものを使います。

VS Code などから継承される `ELECTRON_RUN_AS_NODE=1` は、起動スクリプトで Electron 子プロセスからだけ除去します。通常の開発シェルは従来どおりで、デスクトップ用パッケージを自動追加しません。インストール・ビルドも手動です。

メインウィンドウを閉じると Bot を停止し、全画面の SSE / HTTP 接続を閉じてから Mock の終了と JSON 保存を待ちます。開発起動の Ctrl+C / SIGTERM も同じ終了処理を使用します。
同じ保存先での二重起動は防ぎ、再度起動したときは既存の画面を表示します。

現在の npm が依存パッケージの install script を保留する場合に備え、Electron・esbuild・electron-winstaller の確認済みバージョンだけを `allowScripts` に記録しています。これらのバージョンを変更したときは [npm のスクリプト確認手順](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/) に従い、このプロジェクト内の該当項目を更新します。

2026-10-29、WSL2 / NixOS 26.05・Nixpkgs Electron 43.7.11 で管理画面からの起動、同じメインウィンドウ内でのチャットとの往復、リサイズ、日本語表示、管理セッション分離、ロール・チャンネル権限の保存、Botコマンドの保存・起動・再起動・停止と stdout 表示、メインウィンドウを閉じたときの正常終了を実画面で確認しました。ブラウザの ADMIN リンクによる通常のページ遷移も確認しています。Windows / macOS の実行と GUI はこの環境では検証していません。

参照: [Electron の実行ファイル差し替え](https://www.electronjs.org/docs/latest/api/environment-variables#electron_override_dist_path)、[Electron のサポート方針](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)。

## 配布物の作成

リポジトリ直下で次のコマンドを1回実行すると、Web・Windows・macOS・Linux をまとめて生成します。現在の WSL2 / NixOS からも実行できます。ルートの依存を `pnpm install` 済みであることが前提です。Desktop の依存が未導入・指定バージョンと異なる場合は、このコマンド内で準備します。

```sh
pnpm build
```

| 出力 | 内容 |
| --- | --- |
| `release/web/discord-mock.cjs` | Web画面とローカルMockを同梱した Node.js 用サーバー |
| `release/desktop/*-windows-x64.exe` | Windows x64 のポータブル exe |
| `release/desktop/*-macos-x64.zip` | Intel Mac の `.app` を含む ZIP |
| `release/desktop/*-macos-arm64.zip` | Apple Silicon Mac の `.app` を含む ZIP |
| `release/desktop/*-linux-x86_64.AppImage` | Linux x64 の AppImage |
| `release/manifest.json` | 今回成功した成果物の一覧・サイズ・SHA-256 |

Web 版は `node release/web/discord-mock.cjs` で起動し、表示されたローカルURLを開きます。Node.js 24.17以降が必要で、配布先で npm・pnpm・node_modules は不要です。Web画面の利用には同梱サーバーの起動が必要です。

一括ビルドは Web → Server → JS SDK → サンプルBot → Desktop の順で更新し、各OSの公式 Electron 配布物にアプリを組み込みます。署名・公証・外部公開は行いません。生成に失敗した場合は非0で終了し、今回の成功一覧を残しません。実行時のダミーデータ・トークン・Bot起動設定を配布物へコピーしません。

macOS は署名なしの `.app` を生成するため Linux からもパッケージ化できますが、実際の Windows / macOS での起動確認や Apple の署名・公証は別です。Windows 上からの macOS ビルドには electron-builder が対応しないため、全OS一括は WSL/Linux を使用してください。将来ネイティブ依存を加えた場合はクロスビルドできる条件も再確認します。[electron-builder の制約](https://www.electron.build/v26/docs/features/multi-platform-build/)

対象を個別に生成するコマンドは次のとおりです。

| コマンド | 生成する配布物 |
| --- | --- |
| `pnpm build:web` | Web用サーバー |
| `pnpm build:win` | Windows x64 exe |
| `pnpm build:mac` | macOS x64 / arm64 ZIP |
| `pnpm build:linux` | Linux x64 AppImage |

個別ビルドでも必要な Web / Server のソースを先にビルドしますが、配布物は指定した対象だけを生成し、`release/manifest-<対象>.json` に記録します。開発・SDKテスト用のソース一式だけなら `pnpm build:core` を使えます。`pnpm build:all` は `pnpm build` の互換エイリアスです。GitHub Actions も個別コマンドを各OSのRunnerで実行し、Webを独立したartifactへ保存します。GitHub Releaseへの公開は行いません。

ビルド済みソースから個別にパッケージ化する既存コマンドも維持しています。

- Windows: pnpm desktop:dist:win → ポータブル exe
- macOS: pnpm desktop:dist:mac → .app フォルダー
- Linux: pnpm desktop:dist:linux → AppImage

生成先は release/desktop/ です。テストクライアントのディレクトリと同じ場所に配布物を置き、実行ファイルを開けます。macOS の .app はフォルダー全体がアプリです。GitHub Actions は実行ファイルを artifact に保存しますが、署名・公証やGitHub Release公開は自動実施しません。

## 管理画面からの Bot 起動

実行ファイル欄の右側にある **自動取得** を押すと、読み取り対象のフォルダーを示す確認モーダルが開きます。**確認して読み取る** を押すまでファイルは読み取りません。アプリと同じフォルダー直下の JS / TS を構文解析し、`dismock/e2e` の `runTestClient` を呼んでいるファイルを探します。起動ファイル名は任意です。コメント・文字列・型宣言・サブフォルダー・シンボリックリンクは候補にしません。複数見つかった場合は選択欄から選びます。

選択したファイルに合わせて実行ファイル・引数・作業ディレクトリを入力します。**起動** または **再起動** を押すと、入力した設定を保存して実行します。自動取得やファイル選択だけでは実行しません。候補ゼロ・読み取りエラーでは現在の入力を維持します。

自動取得の JS / TS はアプリ内蔵の Node.js で実行します。TS / JSX では利用側プロジェクトまたは dismock に導入済みの `tsx` を使用し、最寄りの `tsconfig.json` を引数に設定します。依存パッケージのインストールは行いません。読み取り対象はアプリ起動時に決まったフォルダーで、作業ディレクトリ欄を書き換えても変わりません。

`runTestClient` が起動したプロジェクトの Mock / DB に、アプリ内の管理画面・チャット・DB・自動テストを自動接続します。別のブラウザを開く必要はありません。停止・異常終了時はアプリの待機用管理画面に戻り、再起動時は新しい接続先へ切り替えます。接続状態と URL は起動設定欄に表示します。起動前の待機環境と、起動後のプロジェクト環境はそれぞれ別の状態を持ちます。

接続情報は起動ごとの nonce を付け、所有者専用ファイル（0600）で受け渡します。管理セッションは管理画面の HttpOnly cookie だけに設定し、チャットには渡しません。接続先は `127.0.0.1` の HTTP に限定し、外部 URL・別の起動要求の通知・不正な管理セッションは拒否します。Cookie を引き継がずに画面を再読込するため、停止・再起動で別プロセスのユーザー状態を混在させません。

管理画面で変更したプロジェクトのリソースは、そのプロジェクトの保存先にある `state.json` に保存します。`DISCORD_MOCK_STATE_PATH` が指定されている場合はそちらを使います。PGlite の DB と実行履歴は従来どおり App の稼働中だけ共有し、App 再起動時に初期化します。

テストクライアントの `app.lock` / `bot.lock` は、強制終了後でも次の起動時に所有者の PID が終了済みなら自動回復します。動作中・判定不能なロックは保護します。この処理は利用側の `dismock` ライブラリが行うため、既に導入済みのプロジェクトではライブラリ側も更新してください。フォルダーを開くだけではロックを削除しません。

手動設定では実行ファイル名（例: node）、引数（JSON 配列の例: ["dist/bot.js"]）、絶対パスの作業ディレクトリを入力して起動を押します。設定保存だけを押した場合は起動しません。再起動は入力中の設定を保存し、現在のBotを終了させてから起動します。

コマンドは shell:false で直接起動されます。信頼できるテスト用Botだけを指定してください。子プロセスに DISCORD_MOCK_URL、DISCORD_MOCK_TOKEN、TOKEN が渡されます。ただしDiscord SDKの接続先差し替えには別途Mockアダプターが必要です。実Discord APIへの通信を OS レベルで禁止するものではありません。

MockデータはElectronの userData/local-mock/state.json、起動設定は userData/local-mock/bot-config.json に保存されます。管理APIは127.0.0.1に限定されます。保存したBot起動コマンドは次回も使用できますが、起動は管理画面からの手動操作です。

**制約:** テストクライアント側にも、この接続通知に対応した `dismock` と必要な依存を導入してください。プロジェクトの PGlite / TestCaseRunner を使用し、配布アプリ側からインストールは行いません。VC実音声・全Discord API互換・署名・公証・自動更新は未実装です。SaaS化・外部公開は行いません。
