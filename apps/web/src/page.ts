import styles from "./styles.css";
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
<script src="/_ui/client.js" defer></script>
</head>
<body>
<div class="app">
  <aside class="rail">
    <div class="mark" aria-label="Discord Mock">M</div>
    <a href="/test" id="test-link" class="active">TEST</a>
    <a href="/database" id="database-link">DB</a>
    <a href="/tests" id="tests-link">UT</a>
    <a href="/admin" id="admin-link">ADMIN</a>
  </aside>
  <aside class="sidebar">
    <header id="server-title" class="server-title">Mock Guild</header>
    <nav class="sidebar-tabs" aria-label="表示切替">
      <a href="/test">チャット</a><a href="/database">データベース</a><a href="/tests">自動テスト</a>
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
      <label for="identity">ログイン中のテストユーザー</label>
      <select id="identity" aria-label="ダミーユーザー選択"></select>
    </div>
  </aside>
  <main class="main" id="test-panel">
    <header class="topbar">
      <strong id="channel-title"># general</strong>
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
      <div class="test-case-caption"><strong id="test-case-title">テストケース</strong><span id="test-case-status" role="status">読み込み中…</span></div>
      <div id="test-case-list" class="test-case-list" role="listbox" tabindex="0" aria-labelledby="test-case-title" aria-describedby="test-case-help" aria-disabled="true">
        <div class="test-case-empty">読み込み中…</div>
      </div>
      <p id="test-case-help" class="hint">矢印キーで選択 · Enter / ダブルクリックで実行 · ● は3秒間表示<br>users: "login" は右側で選んだユーザーとして実行します。</p>
    </div>
  </main>
  <main class="main database-page hidden" id="database-panel">
    <header class="topbar">
      <div><span class="database-eyebrow">LOCAL DATABASE</span><strong id="database-title">データベース</strong></div>
      <span class="readonly-badge">読み取り専用</span>
    </header>
    <div id="database-error" class="error" role="alert"></div>
    <div id="database-notice" class="database-welcome">
      <span class="database-eyebrow">RECORD EXPLORER</span>
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
    <h2>管理画面</h2>
    <p>現在のテスト用ユーザーとチャンネルはローカルで初期化されます。管理 API の認証は、テスト用ユーザーの切り替えとは分離されています。</p>
    <p>音声プロトコル・VC 再生、DM、権限ベースの管理 UI はまだ未実装です。</p>
    <p><a href="/database">データベースのレコードを見る</a></p>
    <p><a href="/test">テスト画面に戻る</a></p>
  </section>
</div>
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
