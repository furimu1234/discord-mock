import styles from "./styles.css";
import workspaceStyles from "./workspace.css";
import browserScript from "../dist/browser.js.txt";

/** Local-only interface: no third-party scripts, fonts, or stylesheets. */
export function renderPage(): string {
  return String.raw`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>discord-mock | Test</title>
<style>${styles}</style>
<style>${workspaceStyles}</style>
<script src="/_ui/client.js" defer></script>
</head>
<body>
<svg class="workspace-icons" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <symbol id="ui-chat" viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-8a9 9 0 1 1 18-2Z"/><path d="M8 9h8m-8 4h5"/></symbol>
  <symbol id="ui-database" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></symbol>
  <symbol id="ui-test" viewBox="0 0 24 24"><path d="m9 4-5 8 5 8m6-16 5 8-5 8m-4-4 2-8"/></symbol>
  <symbol id="ui-settings" viewBox="0 0 24 24"><path d="M4 7h7m5 0h4M4 17h4m5 0h7"/><circle cx="13" cy="7" r="3"/><circle cx="10" cy="17" r="3"/></symbol>
  <symbol id="ui-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></symbol>
  <symbol id="ui-users" viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m1-18a4 4 0 0 1 0 8m2 3a6 6 0 0 1 3 5v2"/></symbol>
  <symbol id="ui-shield" viewBox="0 0 24 24"><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/></symbol>
  <symbol id="ui-hash" viewBox="0 0 24 24"><path d="M9 3 7 21M17 3l-2 18M3 9h18M2 16h18"/></symbol>
  <symbol id="ui-terminal" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="m6 8 4 4-4 4m7 0h5"/></symbol>
  <symbol id="ui-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol>
</svg>
<div class="app">
  <nav class="rail" aria-label="主な画面">
    <div class="mark" aria-label="discord-mock">discord-mock</div>
    <a href="/test" id="test-link" class="active" title="テスト画面"><svg class="ui-icon" aria-hidden="true"><use href="#ui-chat"/></svg><span>テスト</span></a>
    <a href="/database" id="database-link" title="データベース"><svg class="ui-icon" aria-hidden="true"><use href="#ui-database"/></svg><span>データベース</span></a>
    <a href="/tests" id="tests-link" title="テスト実行履歴"><svg class="ui-icon" aria-hidden="true"><use href="#ui-test"/></svg><span>実行履歴</span></a>
    <a href="/admin" id="admin-link" title="管理画面"><svg class="ui-icon" aria-hidden="true"><use href="#ui-settings"/></svg><span>管理</span></a>
    <div class="rail-local"><span></span>ローカル</div>
  </nav>
  <aside class="sidebar">
    <header id="server-title" class="server-title">Mock Guild</header>
    <nav class="admin-sections" aria-label="管理画面の設定項目">
      <p class="minor">管理項目</p>
      <a href="/admin#desktop-controls" class="admin-launch-link"><svg class="ui-icon" aria-hidden="true"><use href="#ui-terminal"/></svg>テストクライアント</a>
      <a href="/admin#desktop-window-settings" class="admin-window-link"><svg class="ui-icon" aria-hidden="true"><use href="#ui-grid"/></svg>ウィンドウ</a>
      <a href="/admin#admin-overview"><svg class="ui-icon" aria-hidden="true"><use href="#ui-grid"/></svg>サーバー設定</a>
      <a href="/admin#admin-users-section"><svg class="ui-icon" aria-hidden="true"><use href="#ui-users"/></svg>ダミーユーザー</a>
      <a href="/admin#admin-roles-section"><svg class="ui-icon" aria-hidden="true"><use href="#ui-shield"/></svg>ロール・権限</a>
      <a href="/admin#admin-channels-section"><svg class="ui-icon" aria-hidden="true"><use href="#ui-hash"/></svg>チャンネル</a>
      <a href="/admin#admin-members-section"><svg class="ui-icon" aria-hidden="true"><use href="#ui-users"/></svg>メンバーの所属</a>
      <div class="admin-sidebar-note"><svg class="ui-icon" aria-hidden="true"><use href="#ui-shield"/></svg><strong>ローカルのテスト環境</strong><p>ダミーのユーザーやチャンネルを使って、Bot の動作を確認できます。</p></div>
    </nav>
    <div id="channel-sidebar">
    <div class="channel-header">
      <div class="minor">テキストチャンネル</div>
      <button id="channel-create" type="button" aria-label="チャンネルを作成" title="チャンネルを作成">＋</button>
    </div>
    <form id="channel-create-form" class="channel-create-form hidden">
      <label for="channel-create-name">新しいテキストチャンネル</label>
      <input id="channel-create-name" maxlength="100" placeholder="チャンネル名" required aria-label="新しいチャンネル名">
      <div class="channel-create-actions">
        <button id="channel-create-cancel" type="button">キャンセル</button>
        <button id="channel-create-submit" type="submit">作成</button>
      </div>
    </form>
    <nav id="channels" class="channels" aria-label="チャンネル一覧"></nav>
    </div>
    <div id="database-sidebar" class="hidden">
      <div class="minor">テーブル</div>
      <nav id="database-tables" class="channels" aria-label="テーブル一覧"></nav>
    </div>
    <div id="tests-sidebar" class="hidden">
      <div class="minor">テスト実行</div>
      <nav id="test-runs" class="channels" aria-label="テスト実行一覧"></nav>
    </div>
    <div id="user-panel" class="userpanel">
      <label for="identity">実行ユーザー</label>
      <select id="identity" aria-label="ダミーユーザー選択"></select>
    </div>
  </aside>
  <main class="main" id="test-panel">
    <header class="topbar">
      <div class="channel-context"><span class="channel-emblem"><svg class="ui-icon" aria-hidden="true"><use href="#ui-hash"/></svg></span><div><span class="workspace-kicker">自動テスト</span><strong id="channel-title"># general</strong></div></div>
      <div class="presence">
        <span id="online-dot" class="dot"></span>
        <span id="online-label">Bot 接続待機中</span>
      </div>
    </header>
    <div id="error" role="alert" class="error"></div>
    <div class="test-workspace">
      <div id="messages" class="messages" role="log" aria-live="polite"></div>
      <aside id="test-log-panel" class="test-log-panel hidden" aria-label="自動テスト実行ログ">
        <div class="test-log-header">
          <div class="test-sidebar-tabs" role="tablist" aria-label="右サイドバー切替">
            <button type="button" id="test-log-tab" class="active" role="tab" aria-selected="true">実行ログ</button>
            <button type="button" id="test-users-tab" role="tab" aria-selected="false">ユーザー</button>
          </div>
          <a href="/tests">履歴</a>
        </div>
        <div id="test-log-entries" class="test-log-entries" role="log" aria-live="polite"></div>
        <div id="test-user-list" class="test-user-list hidden" aria-label="テストユーザー一覧"></div>
        <div id="test-user-profile" class="test-user-profile hidden" role="dialog" aria-label="ユーザープロフィール"></div>
        <div id="test-user-menu" class="test-user-menu hidden" role="menu" aria-label="ユーザーメニュー"></div>
      </aside>
    </div>
    <div class="composer" id="manual-composer">
      <div id="command-picker" class="command-picker hidden">
        <div id="command-suggestions" role="listbox" aria-label="スラッシュコマンド"></div>
        <p id="command-empty" class="hint hidden" role="status">登録されたコマンドが見つかりません。</p>
      </div>
      <form id="message-form">
        <textarea id="message-input" maxlength="2000" required aria-label="メッセージ" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="command-suggestions" placeholder="メッセージを入力（/ でコマンド一覧、Enter で送信）"></textarea>
        <button id="send" type="submit">送信</button>
      </form>
      <p class="hint">/ でコマンド一覧。↑↓ で選択、Enter・Tab で補完、Esc で閉じます。Shift+Enter で改行できます。</p>
    </div>
    <div id="test-case-composer" class="composer test-case-composer hidden">
      <div class="test-case-caption"><div class="section-label"><svg class="ui-icon" aria-hidden="true"><use href="#ui-test"/></svg><strong id="test-case-title">テストケース</strong></div><span id="test-case-status" role="status">読み込み中…</span></div>
      <div id="test-case-list" class="test-case-list" role="listbox" tabindex="0" aria-labelledby="test-case-title" aria-describedby="test-case-help" aria-disabled="true">
        <div class="test-case-empty">読み込み中…</div>
      </div>
      <p id="test-case-help" class="hint"><span><kbd>↑</kbd><kbd>↓</kbd> 選択 Enter / ダブルクリックで実行</span><span>実行ユーザーはケースの設定に従います</span></p>
    </div>
  </main>
  <main class="main database-page hidden" id="database-panel">
    <header class="topbar">
      <div><span class="database-eyebrow">レコードの参照</span><strong id="database-title">データベース</strong></div>
      <span class="readonly-badge">読み取り専用</span>
    </header>
    <div id="database-error" class="error" role="alert"></div>
    <div id="database-notice" class="database-welcome">

      <h1>データベース</h1>
      <p id="database-notice-text">レコードを読み込んでいます…</p>
      <button id="database-retry" type="button" class="action">再読み込み</button>
    </div>
    <section id="database-content" class="database-content hidden" aria-label="DB レコード">
      <div class="database-toolbar">
        <label class="database-source-label">表示するDB <select id="database-source" aria-label="DB表示対象"><option value="">AppのDB</option></select></label>
        <label class="database-search">検索 <input id="database-search" type="search" maxlength="200" placeholder="レコードを検索…" aria-label="レコードを検索"></label>
        <button id="database-refresh" class="quiet-button" type="button">更新</button>
      </div>
      <div id="database-status" class="database-status" role="status" aria-live="polite"></div>
      <div id="database-grid" class="database-grid" tabindex="0" aria-label="レコード一覧"></div>
      <footer class="database-footer">
        <span id="database-count">テーブルを選択してください</span>
        <div class="database-pagination">
          <label>表示件数 <select id="database-limit" aria-label="1 ページの表示件数"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option></select></label>
          <button id="database-prev" class="quiet-button" type="button" aria-label="前のページ">←</button>
          <button id="database-next" class="quiet-button" type="button" aria-label="次のページ">→</button>
        </div>
      </footer>
    </section>
  </main>
  <main class="main hidden" id="tests-panel">
    <header class="topbar">
      <strong id="test-run-title">自動テスト</strong>
      <div class="presence"><span id="test-run-status">実行待ち</span><button id="test-runs-refresh" class="quiet-button" type="button">最新を表示</button></div>
    </header>
    <div id="test-run-error" class="error" role="alert"></div>
    <section class="test-progress" aria-label="実行の経過"><ol id="test-run-steps" aria-live="polite"></ol></section>
    <div id="test-run-messages" class="messages" role="log" aria-live="polite"></div>
  </main>
  <section id="admin-panel" class="admin-page hidden">
    <header class="admin-heading">
      <div><span class="workspace-kicker">環境コントロール</span><h1>環境設定</h1><p>ユーザー・チャンネル・ロールを管理します。</p></div>
      <div class="guild-context"><svg class="ui-icon" aria-hidden="true"><use href="#ui-grid"/></svg><div><span>現在のサーバー</span><strong id="admin-guild-title">Mock Guild</strong></div></div>
    </header>
    <p id="admin-status" role="status" aria-live="polite"></p>
    <form id="admin-login" class="admin-box">
      <div class="card-heading"><span class="card-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-shield"/></svg></span><h2>管理者ログイン</h2></div>
      <p>CLI に表示された管理者シークレットを入力してください。テストユーザーのログインとは別です。</p>
      <label for="admin-secret">管理者シークレット</label>
      <input id="admin-secret" type="password" autocomplete="off" placeholder="管理者シークレット" required>
      <button type="submit">ログイン</button>
    </form>
    <section id="desktop-controls" class="admin-box hidden">
      <div class="card-heading"><span class="card-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-terminal"/></svg></span><div><h2>Bot の起動設定</h2></div></div>
      <p>起動後は、このウィンドウでそのテストクライアントの管理画面・チャット・DBを操作できます。</p>
      <div class="desktop-fields">
        <label>実行ファイル <span class="desktop-command-row"><input id="desktop-command" placeholder="node / python / pnpm など"><button type="button" id="desktop-detect">自動取得</button></span></label>
        <label>作業ディレクトリ <input id="desktop-cwd" placeholder="絶対パス"></label>
        <label id="desktop-candidate-field" class="hidden">起動ファイルを選択 <select id="desktop-candidates"></select></label>
        <label class="desktop-arguments">引数 <textarea id="desktop-args" rows="2" placeholder='["src/main.ts"]'></textarea></label>
      </div>
      <div class="desktop-actionbar"><div class="admin-buttons">
        <button type="button" id="desktop-start"><svg class="ui-icon" aria-hidden="true"><use href="#ui-arrow"/></svg>起動</button>
        <button type="button" id="desktop-stop">停止</button>
        <button type="button" id="desktop-restart">再起動</button>
        <button type="button" id="desktop-save">設定保存</button>
      </div><p id="desktop-status" role="status"></p></div>
      <p id="desktop-detection-status" role="status"></p>
      <p class="desktop-trust-note">信頼できるコマンドのみ設定してください。引数は JSON の文字列配列で指定します。</p>
    </section>
    <section id="desktop-window-settings" class="admin-box hidden">
      <div class="card-heading"><h2>ウィンドウ</h2></div>
      <p>Mock画面とターミナルの起動先をそれぞれ設定します。</p>
      <div class="desktop-fields">
        <label>Mock画面の起動先<select id="window-mock-display"></select></label>
        <label>ターミナルの起動先<select id="window-terminal-display"></select></label>
      </div>
      <div class="admin-buttons window-settings-actions">
        <button type="button" id="window-settings-save">起動先を保存</button>
        <button type="button" id="window-mock-move">Mock画面を移動</button>
        <button type="button" id="window-terminal-move">ターミナルを移動</button>
        <button type="button" id="window-settings-refresh">ディスプレイを再取得</button>
      </div>
      <p id="window-settings-status" role="status" aria-live="polite"></p>
      <p id="window-position-note" class="desktop-trust-note"></p>
    </section>
    <div id="admin-content" class="admin-grid hidden">
      <div class="admin-summary" role="group" aria-label="環境のリソース数">
        <div><span class="summary-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-users"/></svg></span><span>ユーザー<strong id="admin-user-count">—</strong></span><span class="summary-unit">人</span></div>
        <div><span class="summary-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-hash"/></svg></span><span>チャンネル<strong id="admin-channel-count">—</strong></span><span class="summary-unit">件</span></div>
        <div><span class="summary-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-shield"/></svg></span><span>ロール<strong id="admin-role-count">—</strong></span><span class="summary-unit">件</span></div>
      </div>
      <section class="admin-box admin-overview" id="admin-overview"><div class="card-heading"><span class="card-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-grid"/></svg></span><div><h2>サーバー設定</h2><p>このテスト環境の基本設定</p></div></div><label>サーバー名 <input id="admin-guild-name" maxlength="100"></label><button type="button" id="admin-guild-save">保存</button></section>
      <section class="admin-box" id="admin-users-section"><div class="card-heading"><span class="card-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-users"/></svg></span><h2>ダミーユーザー</h2></div>
        <form id="admin-user-create"><label>ユーザー名<input id="admin-new-user" aria-label="追加するユーザー名" placeholder="ユーザー名" maxlength="100" required></label><label>ID（任意）<input id="admin-new-user-id" aria-label="ユーザーID（任意）" placeholder="ID（任意・17〜20桁）"></label><button type="submit">追加</button></form>
        <div id="admin-users" class="admin-list"></div><div id="admin-user-editor" class="admin-editor"></div>
      </section>
      <section class="admin-box" id="admin-roles-section"><div class="card-heading"><span class="card-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-shield"/></svg></span><h2>ロールと基本権限</h2></div>
        <form id="admin-role-create"><label>ロール名<input id="admin-new-role" aria-label="追加するロール名" placeholder="ロール名" maxlength="100" required></label><label>ID（任意）<input id="admin-new-role-id" aria-label="ロールID（任意）" placeholder="ID（任意）"></label><button type="submit">追加</button></form>
        <div id="admin-roles" class="admin-list"></div><div id="admin-role-editor" class="admin-editor"></div>
      </section>
      <section class="admin-box" id="admin-channels-section"><div class="card-heading"><span class="card-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-hash"/></svg></span><h2>チャンネルと権限の上書き</h2></div>
        <form id="admin-channel-create"><label>チャンネル名<input id="admin-new-channel" aria-label="追加するチャンネル名" placeholder="チャンネル名" maxlength="100" required></label><label>種類<select id="admin-new-channel-type" aria-label="チャンネルの種類"><option value="0">テキスト</option><option value="2">VC</option></select></label><label>ID（任意）<input id="admin-new-channel-id" aria-label="チャンネルID（任意）" placeholder="ID（任意）"></label><button type="submit">追加</button></form>
        <div id="admin-channels" class="admin-list"></div><div id="admin-channel-editor" class="admin-editor"></div>
      </section>
      <section class="admin-box" id="admin-members-section"><div class="card-heading"><span class="card-icon"><svg class="ui-icon" aria-hidden="true"><use href="#ui-users"/></svg></span><h2>メンバーの所属ロール</h2></div>
        <label>ユーザー <select id="admin-member-select"></select></label><div id="admin-member-roles" class="admin-editor"></div>
      </section>
    </div>
  </section>
</div>
<dialog id="desktop-detect-dialog" class="desktop-detect-dialog" aria-labelledby="desktop-detect-title">
  <h2 id="desktop-detect-title">テストクライアントの自動取得</h2>
  <p>アプリと同じフォルダー直下の JavaScript / TypeScript ファイルを読み取り、dismock/e2e の runTestClient を呼び出す起動ファイルを探します。</p>
  <p id="desktop-detect-directory"></p>
  <p>起動に必要なプロジェクト内の tsconfig と tsx の場所も確認します。取得結果を起動設定に入力し、「起動」を押すと実行します。</p>
  <div class="admin-buttons"><button type="button" id="desktop-detect-cancel">キャンセル</button><button type="button" id="desktop-detect-confirm">確認して読み取る</button></div>
</dialog>
<div id="message-menu" class="message-menu hidden" role="menu" aria-label="メッセージの操作"></div>
<div id="message-dialog" class="message-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="message-dialog-title">
  <form id="message-edit-form" class="message-edit-form">
    <strong id="message-dialog-title">メッセージを編集</strong>
    <label class="sr-only" for="message-edit-content">メッセージ本文</label>
    <textarea id="message-edit-content" maxlength="2000" rows="5"></textarea>
    <p id="message-delete-preview" class="hidden"></p>
    <p id="message-edit-error" role="alert"></p>
    <div class="message-edit-actions"><button id="message-edit-cancel" type="button">キャンセル</button><button id="message-edit-save" type="submit">保存</button></div>
  </form>
</div>
</body>
</html>`;
}

/** Compiled once at build time and embedded in the standalone server bundle. */
export function renderBrowserScript(): string {
  return browserScript;
}
