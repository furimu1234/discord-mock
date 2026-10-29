# Window Layout Implementation Plan

**Goal:** 枠なしのMock画面とターミナルを8方向にリサイズでき、各画面の起動ディスプレイとディスプレイごとの最後の位置・サイズを復元する。

**Authorization:** 既存UI改善の続きとして、ユーザーが本機能の実装を依頼。細部を任せて実装まで進める既存の指定に従う。

## Design and constraints

- OS枠は非表示。細いドラッグバーと最小化・最大化・閉じる操作、見えない8方向のリサイズ領域を付ける。
- Mockの管理画面・チャットのセッション隔離を維持する。Mockの操作バーは専用のローカルWebContentsViewと限定preloadで構成し、チャットに管理IPCを渡さない。
- 管理画面の「ウィンドウ」で、Mock・ターミナルそれぞれの起動先（最後に使った画面／メイン画面／指定画面）を保存する。保存後は次回起動に反映し、「移動」は現在のウィンドウにも反映する。
- 位置はディスプレイ作業領域に対する相対座標とサイズ、最大化状態を保存する。2つのウィンドウと各ディスプレイの履歴は分離する。
- 未接続画面・解像度変更・負の座標・拡大率を考慮し、表示可能な作業領域内にクランプする。再接続用に未接続画面の履歴は保持する。
- ローカルJSONはversion付き、入力を検証、直列かつ原子的に書き込む。不正JSONを黙って消さない。
- Electronの公開APIのみ。LinuxでDISPLAYがあり、明示的なozone-platform指定がなければ、座標を扱えるX11を選択。Waylandが指定されている場合は制約を表示する。
- 既存のTypeScript・ループバック・認証・sandboxを保持。既存の未コミット変更を基点にし、無断マージ・公開は行わない。

## Tasks

- [x] 1. 純粋な型・座標処理・JSON保存とテスト。`window-types.ts` / `window-state.ts`。
- [x] 2. 枠なし操作バーのレンダラー・CSS・local HTML・限定preloadとテスト。
- [x] 3. Electronコントローラー、既存2ウィンドウとIPC、管理画面設定、レスポンシブを接続。
- [x] 4. 型検査・回帰テスト、Electronで移動／8方向リサイズ／終了と再起動復元、ブラウザ設定、独立レビューを確認。配布物を更新。

## Interfaces

型の正本は `apps/desktop/src/window-types.ts`。`WindowId = "mock" | "terminal"`、`ResizeEdge = "n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"nw"`。ディスプレイIDは文字列、起動先は `"last" | "primary" | displayId`。

画面に公開する設定は `WindowLayoutSettings = {displays: DisplayInfo[], windows: Record<WindowId,{startupDisplay:string;lastDisplayId?:string}>, positionSupported:boolean}`。

枠レンダラーの限定APIは `window.discordMockWindow = {action(action:"minimize"|"maximize"|"close"):Promise<void>, resize(phase:"start"|"move"|"end", payload:unknown):void}`。startは `{edge,screenX,screenY}`、moveは `{screenX,screenY}`、endはデータなし。

管理ブリッジに `windowSettings()`、`saveWindowSettings(value:{mock:string;terminal:string})`、`moveWindow(id:WindowId,displayId:string)` を追加。いずれも既存のadminHandlerで認証する。

## Verification record

- `node --test apps/desktop/tests/window-{state,controller,frame}.test.ts`: 最初の欠落実装・入力検証失敗を確認後、実装して成功。
- 設定UIの3テストをRED→GREEN。未接続画面の保持、両画面の保存と移動、エラー表示、Waylandでの移動無効化。
- 独立レビュー: `/root/window_layout_review`。IPCの送信元・main frame・URL検証とセッション分離は維持。保存キューの失敗からの回復、最大化後の最小化状態保持を指摘。両方をRED→GREENで修正。
- レビューの初回最大化による読み込み前表示の指摘も、初回表示まで最大化を遅らせるテストをRED→GREENで修正。
- ネイティブ検証でLinuxのresize中にcontent sizeが1イベント前になる現象を再現。次のイベントループでレイアウトする修正により、実ポインター経路のリサイズと内部画面が一致。
- WSLgの初回ConfigureNotifyで起動位置が原点へ戻る現象を再現。初回だけ100ms後に配置し、表示前の座標を保存しない処理を追加。表示前の履歴保護テストもRED→GREEN。通常のリサイズ・移動にはこの遅延を適用しない。
- WSL/NixOSの3画面でMock・ターミナルそれぞれの画面間移動、各画面の位置・サイズ履歴、異なる画面への再起動復元をネイティブ検証。8方向の実ウィンドウ変形とポインターキャプチャ経路を確認。650×450のチャット・管理・ターミナルのスクリーンショットを確認。
- 一連のログ・検証スクリプト・画像は `/tmp/discord-mock-window-layout/`。Windows/macOSの実機検証はこの環境では行わない。
- `pnpm check`、Desktopの型検査、`pnpm desktop:test`（54/54）成功。`pnpm test`はWeb・Server・JSクライアントの全スイート成功。
- Playwright/Pythonでログ180行を表示し、1060×700・650×450・800×500の内部スクロール、画面外にはみ出さないこと、検索・Ctrl+F/Escapeを確認。ログ領域は最小ウィンドウでも157px。
- ネイティブの通常配置復元と最大化復元は成功。WSLgが最小化状態を通知しないため、その状態遷移の実機確認には制約あり。最大化→最小化→終了時の保存ロジックは単体テストで検証。
- 最終 `pnpm build` 成功。2026-10-29T11:43:35ZのmanifestにWeb・Windows・macOS x64/arm64・Linuxの5成果物を記録。`git diff --check` 成功。ソース・配布物を更新し、コミット・マージ・公開は行っていない。
