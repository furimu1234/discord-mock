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
<title>discord-mock</title>
<style>${styles}</style>
<style>${workspaceStyles}</style>
<script src="/_ui/client.js" defer></script>
</head>
<body>
<svg class="workspace-icons" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display: none;">
  <symbol id="ui-chat" viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-8a9 9 0 1 1 18-2Z"/><path d="M8 9h8m-8 4h5"/></symbol>
  <symbol id="ui-database" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></symbol>
  <symbol id="ui-test" viewBox="0 0 24 24"><path d="m9 4-5 8 5 8m6-16 5 8-5 8m-4-4 2-8"/></symbol>
  <symbol id="ui-settings" viewBox="0 0 24 24"><path d="M4 7h7m5 0h4M4 17h4m5 0h7"/><circle cx="13" cy="7" r="3"/><circle cx="10" cy="17" r="3"/></symbol>
  <symbol id="ui-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></symbol>
  <symbol id="ui-users" viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m1-18a4 4 0 0 1 0 8m2 3a6 6 0 0 1 3 5v2"/></symbol>
  <symbol id="ui-shield" viewBox="0 0 24 24"><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/></symbol>
  <symbol id="ui-hash" viewBox="0 0 24 24"><path d="M9 3 7 21M17 3l-2 18M3 9h18M2 16h18"/></symbol>
  <symbol id="ui-terminal" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18"/><path d="m6 8 4 4-4 4m7 0h5"/></symbol>
  <symbol id="ui-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol>
  <symbol id="ui-sidebar-toggle" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="15" y1="3" x2="15" y2="21" stroke="currentColor" stroke-width="1.5"/></symbol>
</svg>
<div class="app">
  <!-- グローバル上部ナビゲーションバー -->
  <header class="global-navbar">
    <div class="nav-brand-area">
      <span class="brand-title">discord-mock</span>
      <span class="brand-badge">ローカル</span>
    </div>
    <nav class="nav-links" aria-label="主な画面">
      <a href="/test" id="test-link" class="nav-link active" title="テスト画面">テスト</a>
      <a href="/tests" id="tests-link" class="nav-link" title="テスト実行履歴">実行履歴</a>
      <a href="/database" id="database-link" class="nav-link" title="データベース">データベース</a>
      <a href="/admin" id="admin-link" class="nav-link" title="管理画面">管理</a>
    </nav>
    <div class="nav-actions-area">
      <div class="presence-status">
        <span id="online-dot" class="dot"></span>
        <span id="online-label">Bot 接続待機中</span>
      </div>
      <div id="user-panel" class="actor-select-wrapper">
        <label for="identity" class="actor-label">実行ユーザー</label>
        <select id="identity" class="actor-select" aria-label="ダミーユーザー選択"></select>
      </div>
    </div>
  </header>

  <!-- メイン作業領域 -->
  <div class="workspace-container">
    <!-- /test 画面: 3ペイン構成 -->
    <main class="main-panel test-page-layout" id="test-panel">
      <!-- 左ペイン: チャンネル一覧 -->
      <div id="channel-sidebar" class="pane-sidebar channel-sidebar">
        <div class="pane-sidebar-header">
          <header id="server-title" class="server-title">Mock Guild</header>
          <button id="channel-create" type="button" class="btn-icon" aria-label="チャンネルを作成" title="チャンネルを作成">＋</button>
        </div>
        <form id="channel-create-form" class="channel-create-form hidden">
          <label for="channel-create-name" class="sr-only">新しいテキストチャンネル</label>
          <input id="channel-create-name" maxlength="100" placeholder="チャンネル名" required aria-label="新しいチャンネル名">
          <div class="channel-create-actions">
            <button id="channel-create-cancel" type="button">キャンセル</button>
            <button id="channel-create-submit" type="submit">作成</button>
          </div>
        </form>
        <div class="sidebar-subheading">テキストチャンネル</div>
        <nav id="channels" class="channel-list" aria-label="チャンネル一覧"></nav>
      </div>

      <!-- 中央ペイン: チャット & コンポーザー -->
      <section class="pane-center chat-center-view">
        <header class="chat-header">
          <div class="chat-channel-context">
            <span class="hash-tag">#</span>
            <strong id="channel-title">general</strong>
          </div>
          <div class="chat-header-actions">
            <button type="button" id="sidebar-toggle-button" class="btn-tool-toggle" aria-label="右サイドバー切替" title="サイドバー表示切替">
              <svg class="ui-icon" aria-hidden="true"><use href="#ui-sidebar-toggle"/></svg>
            </button>
          </div>
        </header>
        <div id="error" role="alert" class="alert-error"></div>
        <div class="chat-messages-area">
          <div id="messages" class="messages" role="log" aria-live="polite"></div>
        </div>

        <!-- 下部統合コンポーザーエリア -->
        <div class="composer-container">
          <div class="composer-toolbar">
            <div class="composer-tabs" role="tablist" aria-label="入力モード">
              <button type="button" id="composer-tab-chat" class="composer-tab-btn" role="tab" aria-selected="false">チャット入力</button>
              <button type="button" id="composer-tab-cases" class="composer-tab-btn active" role="tab" aria-selected="true">テストケース</button>
            </div>
            <div class="composer-status-area">
              <span id="test-case-status" class="test-case-status-text" role="status">読み込み中…</span>
            </div>
          </div>

          <div class="composer" id="manual-composer">
            <div id="command-picker" class="command-picker hidden">
              <div id="command-suggestions" role="listbox" aria-label="スラッシュコマンド"></div>
              <p id="command-empty" class="hint hidden" role="status">登録されたコマンドが見つかりません。</p>
            </div>
            <form id="message-form" class="message-form">
              <textarea id="message-input" maxlength="2000" required aria-label="メッセージ" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="command-suggestions" placeholder="メッセージを入力（/ でコマンド一覧、Enter で送信）"></textarea>
              <button id="send" type="submit" class="btn-send">送信</button>
            </form>
            <p class="hint">/ でコマンド一覧。↑↓ で選択、Enter・Tab で補完、Esc で閉じます。Shift+Enter で改行できます。</p>
          </div>

          <div id="test-case-composer" class="composer test-case-composer hidden">
            <div id="test-case-list" class="test-case-list" role="listbox" tabindex="0" aria-label="テストケース一覧" aria-describedby="test-case-help" aria-disabled="true">
              <div class="test-case-empty">読み込み中…</div>
            </div>
            <p id="test-case-help" class="hint"><span><kbd>↑</kbd><kbd>↓</kbd> 選択 Enter / ダブルクリックで実行</span><span>実行ユーザーはケースの設定に従います</span></p>
          </div>
        </div>
      </section>

      <!-- 右ペイン: 実行ログ & ユーザー一覧 -->
      <aside id="test-log-panel" class="pane-sidebar log-users-sidebar" aria-label="自動テスト実行ログ">
        <header class="log-sidebar-header">
          <div class="test-sidebar-tabs" role="tablist" aria-label="右サイドバー切替">
            <button type="button" id="test-log-tab" class="tab-item active" role="tab" aria-selected="true">実行ログ</button>
            <button type="button" id="test-users-tab" class="tab-item" role="tab" aria-selected="false">ユーザー</button>
          </div>
          <a href="/tests" class="history-link">履歴</a>
        </header>
        <div class="log-sidebar-body">
          <div id="test-log-entries" class="test-log-entries" role="log" aria-live="polite"></div>
          <div id="test-user-list" class="test-user-list hidden" aria-label="テストユーザー一覧"></div>
          <div id="test-user-profile" class="test-user-profile hidden" role="dialog" aria-label="ユーザープロフィール"></div>
          <div id="test-user-menu" class="test-user-menu hidden" role="menu" aria-label="ユーザーメニュー"></div>
        </div>
      </aside>
    </main>

    <!-- /tests 画面: 2ペイン・マスターディテール -->
    <main class="main-panel test-runs-layout hidden" id="tests-panel">
      <div id="tests-sidebar" class="pane-sidebar tests-sidebar">
        <div class="pane-sidebar-header">
          <div class="sidebar-title">テスト実行</div>
          <button id="test-runs-refresh" class="btn-refresh" type="button" title="最新を表示">更新</button>
        </div>
        <nav id="test-runs" class="runs-nav-list" aria-label="テスト実行一覧"></nav>
      </div>
      <section class="pane-center test-runs-detail">
        <header class="detail-header">
          <div class="detail-title-group">
            <strong id="test-run-title">自動テスト</strong>
            <span id="test-run-status" class="status-tag">実行待ち</span>
          </div>
        </header>
        <div id="test-run-error" class="alert-error" role="alert"></div>
        <div class="test-runs-split">
          <section class="test-progress-section" aria-label="実行の経過">
            <div class="section-label-text">実行ステップ</div>
            <ol id="test-run-steps" class="test-steps-list" aria-live="polite"></ol>
          </section>
          <section class="test-messages-section" aria-label="メッセージログ">
            <div class="section-label-text">メッセージログ</div>
            <div id="test-run-messages" class="messages" role="log" aria-live="polite"></div>
          </section>
        </div>
      </section>
    </main>

    <!-- /database 画面: 2ペイン・データグリッド -->
    <main class="main-panel database-layout database-page hidden" id="database-panel">
      <div id="database-sidebar" class="pane-sidebar database-sidebar">
        <div class="pane-sidebar-header">
          <div class="sidebar-title">テーブル</div>
          <button id="database-refresh" class="btn-refresh" type="button" title="更新">更新</button>
        </div>
        <nav id="database-tables" class="tables-nav-list" aria-label="テーブル一覧"></nav>
      </div>
      <section class="pane-center database-detail">
        <header class="detail-header">
          <div class="detail-title-group">
            <strong id="database-title">データベース</strong>
            <span class="readonly-badge">読み取り専用</span>
          </div>
          <div class="database-toolbar-controls">
            <label class="db-source-control">
              <span>DB:</span>
              <select id="database-source" aria-label="DB表示対象">
                <option value="">AppのDB</option>
              </select>
            </label>
            <label class="db-search-control">
              <input id="database-search" type="search" maxlength="200" placeholder="レコードを検索…" aria-label="レコードを検索">
            </label>
          </div>
        </header>
        <div id="database-error" class="alert-error" role="alert"></div>
        <div id="database-notice" class="database-welcome">
          <h2>データベース</h2>
          <p id="database-notice-text">レコードを読み込んでいます…</p>
          <button id="database-retry" type="button" class="btn-action">再読み込み</button>
        </div>
        <section id="database-content" class="database-content-pane hidden" aria-label="DB レコード">
          <div id="database-status" class="database-status-indicator" role="status" aria-live="polite"></div>
          <div class="database-grid-container">
            <div id="database-grid" class="database-grid" tabindex="0" aria-label="レコード一覧"></div>
          </div>
          <footer class="database-footer-bar">
            <span id="database-count">テーブルを選択してください</span>
            <div class="database-pagination-controls">
              <label>表示件数
                <select id="database-limit" aria-label="1 ページの表示件数">
                  <option value="25">25</option>
                  <option value="50" selected>50</option>
                  <option value="100">100</option>
                </select>
              </label>
              <button id="database-prev" class="btn-page" type="button" aria-label="前のページ">←</button>
              <button id="database-next" class="btn-page" type="button" aria-label="次のページ">→</button>
            </div>
          </footer>
        </section>
      </section>
    </main>

    <!-- /admin 画面: 2ペイン設定UI -->
    <section id="admin-panel" class="main-panel admin-layout admin-page hidden">
      <div class="pane-sidebar admin-sidebar">
        <div class="pane-sidebar-header">
          <div class="sidebar-title">管理項目</div>
        </div>
        <nav class="admin-sections" aria-label="管理画面の設定項目">
          <a href="/admin#desktop-controls" class="admin-nav-item active" data-target="desktop-controls">Bot起動設定</a>
          <a href="/admin#desktop-window-settings" class="admin-nav-item" data-target="desktop-window-settings">ウィンドウ設定</a>
          <a href="/admin#admin-overview" class="admin-nav-item" data-target="admin-overview">サーバー設定</a>
          <a href="/admin#admin-users-section" class="admin-nav-item" data-target="admin-users-section">ダミーユーザー</a>
          <a href="/admin#admin-roles-section" class="admin-nav-item" data-target="admin-roles-section">ロール・権限</a>
          <a href="/admin#admin-channels-section" class="admin-nav-item" data-target="admin-channels-section">チャンネル</a>
          <a href="/admin#admin-members-section" class="admin-nav-item" data-target="admin-members-section">メンバーの所属</a>
        </nav>
      </div>
      <div class="pane-center admin-detail-pane">
        <header class="detail-header">
          <div class="detail-title-group">
            <span class="sub-label">環境設定</span>
            <strong id="admin-guild-title">Mock Guild</strong>
          </div>
          <p id="admin-status" class="admin-status-message" role="status" aria-live="polite"></p>
        </header>

        <form id="admin-login" class="admin-login-view">
          <h2>管理者ログイン</h2>
          <p class="section-desc">CLI に表示された管理者シークレットを入力してください。テストユーザーのログインとは別です。</p>
          <div class="form-row-compact">
            <label for="admin-secret" class="sr-only">管理者シークレット</label>
            <input id="admin-secret" type="password" autocomplete="off" placeholder="管理者シークレット" required>
            <button type="submit" class="btn-primary">ログイン</button>
          </div>
        </form>

        <div id="admin-content" class="admin-content-view hidden">
          <div class="admin-summary-strip" role="group" aria-label="環境のリソース数">
            <div class="summary-cell">
              <span class="summary-cell-title">ユーザー</span>
              <strong id="admin-user-count" class="summary-cell-value">—</strong>
              <span class="summary-cell-unit">人</span>
            </div>
            <div class="summary-cell">
              <span class="summary-cell-title">チャンネル</span>
              <strong id="admin-channel-count" class="summary-cell-value">—</strong>
              <span class="summary-cell-unit">件</span>
            </div>
            <div class="summary-cell">
              <span class="summary-cell-title">ロール</span>
              <strong id="admin-role-count" class="summary-cell-value">—</strong>
              <span class="summary-cell-unit">件</span>
            </div>
          </div>

          <!-- Bot起動設定 -->
          <section id="desktop-controls" class="admin-section-block">
            <div class="section-block-header">
              <h2>Bot 起動設定</h2>
              <p class="section-desc">起動後は、このウィンドウでそのテストクライアントの管理画面・チャット・DBを操作できます。</p>
            </div>
            <div class="form-fields-grid">
              <label class="field-item">
                <span class="field-label">実行ファイル</span>
                <span class="command-input-row">
                  <input id="desktop-command" placeholder="node / python / pnpm など">
                  <button type="button" id="desktop-detect" class="btn-secondary">自動取得</button>
                </span>
              </label>
              <label class="field-item">
                <span class="field-label">作業ディレクトリ</span>
                <input id="desktop-cwd" placeholder="絶対パス">
              </label>
              <label id="desktop-candidate-field" class="field-item hidden">
                <span class="field-label">起動ファイルを選択</span>
                <select id="desktop-candidates"></select>
              </label>
              <label class="field-item full-span">
                <span class="field-label">引数 (JSON形式)</span>
                <textarea id="desktop-args" rows="2" placeholder='["src/main.ts"]'></textarea>
              </label>
            </div>
            <div class="admin-actions-bar">
              <div class="btn-cluster">
                <button type="button" id="desktop-start" class="btn-primary">起動</button>
                <button type="button" id="desktop-stop" class="btn-secondary">停止</button>
                <button type="button" id="desktop-restart" class="btn-secondary">再起動</button>
                <button type="button" id="desktop-save" class="btn-secondary">設定保存</button>
              </div>
              <p id="desktop-status" role="status" class="field-status"></p>
            </div>
            <p id="desktop-detection-status" role="status" class="field-status"></p>
            <p class="field-note">信頼できるコマンドのみ設定してください。引数は JSON の文字列配列で指定します。</p>
          </section>

          <!-- ウィンドウ設定 -->
          <section id="desktop-window-settings" class="admin-section-block">
            <div class="section-block-header">
              <h2>ウィンドウ</h2>
              <p class="section-desc">Mock画面とターミナルの起動先をそれぞれ設定します。</p>
            </div>
            <div class="form-fields-grid">
              <label class="field-item">
                <span class="field-label">Mock画面の起動先</span>
                <select id="window-mock-display"></select>
              </label>
              <label class="field-item">
                <span class="field-label">ターミナルの起動先</span>
                <select id="window-terminal-display"></select>
              </label>
            </div>
            <div class="admin-actions-bar">
              <div class="btn-cluster">
                <button type="button" id="window-settings-save" class="btn-primary">起動先を保存</button>
                <button type="button" id="window-mock-move" class="btn-secondary">Mock画面を移動</button>
                <button type="button" id="window-terminal-move" class="btn-secondary">ターミナルを移動</button>
                <button type="button" id="window-settings-refresh" class="btn-secondary">ディスプレイを再取得</button>
              </div>
              <p id="window-settings-status" role="status" class="field-status"></p>
            </div>
            <p id="window-position-note" class="field-note"></p>
          </section>

          <!-- サーバー設定 -->
          <section id="admin-overview" class="admin-section-block">
            <div class="section-block-header">
              <h2>サーバー設定</h2>
              <p class="section-desc">このテスト環境の基本設定</p>
            </div>
            <div class="form-row-compact">
              <label class="field-item flex-1">
                <span class="field-label">サーバー名</span>
                <input id="admin-guild-name" maxlength="100">
              </label>
              <button type="button" id="admin-guild-save" class="btn-primary align-end">保存</button>
            </div>
          </section>

          <!-- ダミーユーザー -->
          <section id="admin-users-section" class="admin-section-block">
            <div class="section-block-header">
              <h2>ダミーユーザー</h2>
            </div>
            <form id="admin-user-create" class="inline-creation-form">
              <label class="field-item">
                <span class="field-label">ユーザー名</span>
                <input id="admin-new-user" aria-label="追加するユーザー名" placeholder="ユーザー名" maxlength="100" required>
              </label>
              <label class="field-item">
                <span class="field-label">ID（任意）</span>
                <input id="admin-new-user-id" aria-label="ユーザーID（任意）" placeholder="ID（任意・17〜20桁）">
              </label>
              <button type="submit" class="btn-primary align-end">追加</button>
            </form>
            <div class="entity-editor-split">
              <div id="admin-users" class="entity-list"></div>
              <div id="admin-user-editor" class="entity-detail-editor"></div>
            </div>
          </section>

          <!-- ロールと権限 -->
          <section id="admin-roles-section" class="admin-section-block">
            <div class="section-block-header">
              <h2>ロールと基本権限</h2>
            </div>
            <form id="admin-role-create" class="inline-creation-form">
              <label class="field-item">
                <span class="field-label">ロール名</span>
                <input id="admin-new-role" aria-label="追加するロール名" placeholder="ロール名" maxlength="100" required>
              </label>
              <label class="field-item">
                <span class="field-label">ID（任意）</span>
                <input id="admin-new-role-id" aria-label="ロールID（任意）" placeholder="ID（任意）">
              </label>
              <button type="submit" class="btn-primary align-end">追加</button>
            </form>
            <div class="entity-editor-split">
              <div id="admin-roles" class="entity-list"></div>
              <div id="admin-role-editor" class="entity-detail-editor"></div>
            </div>
          </section>

          <!-- チャンネル -->
          <section id="admin-channels-section" class="admin-section-block">
            <div class="section-block-header">
              <h2>チャンネルと権限の上書き</h2>
            </div>
            <form id="admin-channel-create" class="inline-creation-form">
              <label class="field-item">
                <span class="field-label">チャンネル名</span>
                <input id="admin-new-channel" aria-label="追加するチャンネル名" placeholder="チャンネル名" maxlength="100" required>
              </label>
              <label class="field-item">
                <span class="field-label">種類</span>
                <select id="admin-new-channel-type" aria-label="チャンネルの種類">
                  <option value="0">テキスト</option>
                  <option value="2">VC</option>
                </select>
              </label>
              <label class="field-item">
                <span class="field-label">ID（任意）</span>
                <input id="admin-new-channel-id" aria-label="チャンネルID（任意）" placeholder="ID（任意）">
              </label>
              <button type="submit" class="btn-primary align-end">追加</button>
            </form>
            <div class="entity-editor-split">
              <div id="admin-channels" class="entity-list"></div>
              <div id="admin-channel-editor" class="entity-detail-editor"></div>
            </div>
          </section>

          <!-- メンバーの所属ロール -->
          <section id="admin-members-section" class="admin-section-block">
            <div class="section-block-header">
              <h2>メンバーの所属ロール</h2>
            </div>
            <div class="member-role-assignment">
              <label class="field-item max-w-sm">
                <span class="field-label">ユーザーを選択</span>
                <select id="admin-member-select"></select>
              </label>
              <div id="admin-member-roles" class="member-roles-checkboxes"></div>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>
</div>

<!-- モーダル・ダイアログ群 -->
<dialog id="desktop-detect-dialog" class="detect-dialog" aria-labelledby="desktop-detect-title">
  <div class="dialog-inner">
    <h2 id="desktop-detect-title">テストクライアントの自動取得</h2>
    <p>アプリと同じフォルダー直下の JavaScript / TypeScript ファイルを読み取り、dismock/e2e の runTestClient を呼び出す起動ファイルを探します。</p>
    <p id="desktop-detect-directory" class="detect-directory-path"></p>
    <p>起動に必要なプロジェクト内の tsconfig と tsx の場所も確認します。取得結果を起動設定に入力し、「起動」を押すと実行します。</p>
    <div class="dialog-btn-row">
      <button type="button" id="desktop-detect-cancel" class="btn-secondary">キャンセル</button>
      <button type="button" id="desktop-detect-confirm" class="btn-primary">確認して読み取る</button>
    </div>
  </div>
</dialog>

<div id="message-menu" class="message-menu hidden" role="menu" aria-label="メッセージの操作"></div>

<div id="message-dialog" class="message-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="message-dialog-title">
  <form id="message-edit-form" class="message-edit-form">
    <strong id="message-dialog-title">メッセージを編集</strong>
    <label class="sr-only" for="message-edit-content">メッセージ本文</label>
    <textarea id="message-edit-content" maxlength="2000" rows="5"></textarea>
    <p id="message-delete-preview" class="hidden"></p>
    <p id="message-edit-error" role="alert" class="alert-error"></p>
    <div class="dialog-btn-row">
      <button id="message-edit-cancel" type="button" class="btn-secondary">キャンセル</button>
      <button id="message-edit-save" type="submit" class="btn-primary">保存</button>
    </div>
  </form>
</div>
</body>
</html>`;
}

/** Compiled once at build time and embedded in the standalone server bundle. */
export function renderBrowserScript(): string {
  return browserScript;
}
