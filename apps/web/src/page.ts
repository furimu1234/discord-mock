/** Local-only interface: no third-party scripts, fonts, or stylesheets. */
export function renderPage(): string {
  return String.raw\`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>discord-mock | Test</title>
<style>
:root{color-scheme:dark;font:14px/1.5 system-ui,"Segoe UI",sans-serif;background:#1b1c23;color:#e7e9f0}
*{box-sizing:border-box}html,body{margin:0;height:100%}button,input,select{font:inherit}
button,select{cursor:pointer}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #a6b6ff;outline-offset:2px}
a{color:#b8c9ff;text-decoration:none}a:hover{text-decoration:underline}
.app{display:grid;grid-template-columns:72px 244px minmax(0,1fr);min-height:100vh}
.rail{background:#14151a;display:flex;align-items:center;flex-direction:column;gap:14px;padding:21px 8px;border-right:1px solid #2d2f3d}
.mark{height:46px;width:46px;border-radius:17px;background:#5668b6;display:grid;place-items:center;font-size:22px;font-weight:800;color:white}
.rail a{font-size:11px;color:#9ca0b4}.rail .active{color:#e6eafa}
.sidebar{background:#20212a;display:flex;flex-direction:column;border-right:1px solid #343645}
.server-title{padding:22px 18px;border-bottom:1px solid #31333f;font-size:15px;font-weight:800}
.minor{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#8f94a8;margin:20px 16px 7px}
.channels{padding:0 9px}.channel{width:100%;display:flex;gap:8px;text-align:left;border:0;border-radius:6px;background:transparent;color:#acb0c5;padding:10px 11px;font-weight:600}
.channel.selected{background:#393d51;color:white}.channel:hover{background:#343644}
.userpanel{margin-top:auto;border-top:1px solid #343645;background:#1c1d25;padding:15px 11px;display:grid;gap:8px}
.userpanel label{font-size:11px;color:#9ca1ba}.userpanel select{border:1px solid #484b5d;color:white;background:#303240;width:100%;padding:9px;border-radius:6px}
.main{display:flex;min-height:0;flex-direction:column}
.topbar{height:67px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 25px;border-bottom:1px solid #353743;background:#23252f}
.topbar strong{font-size:16px}.presence{display:flex;gap:8px;align-items:center;font-size:12px;color:#b0b6c7}
.dot{width:8px;height:8px;background:#edac59;border-radius:100%}.dot.online{background:#5bd4a4}
.messages{flex:1;overflow:auto;min-height:260px;padding:24px 26px 10px;display:flex;flex-direction:column;gap:2px}
.intro{margin:auto 0 18px;max-width:620px}.intro h2{margin:0 0 5px;font-size:25px}.intro p{color:#adb0c3}
.message{display:flex;gap:14px;border-radius:7px;padding:10px 7px;word-break:break-word}
.message:hover{background:#272a37}
.avatar{display:grid;place-items:center;flex:0 0 41px;height:41px;border-radius:14px;font-weight:700;background:#53659c}
.avatar.bot{background:#536d66}
.meta{display:flex;align-items:baseline;gap:10px}.meta strong{font-size:14px}.meta time{font-size:11px;color:#81889b}
.content{white-space:pre-wrap;color:#dee0ec}
.empty{padding:40px 0;color:#8f94ab}
.composer{border-top:1px solid #343746;padding:19px 25px 24px;background:#22242e}
.composer form{display:flex;gap:10px;align-items:end}.composer textarea{resize:vertical;min-height:52px;max-height:180px;flex:1;border:1px solid #4e5265;background:#303342;color:white;padding:14px;border-radius:9px;font:inherit}
.composer button,.action{border:0;border-radius:8px;background:#586cc6;color:#fff;font-weight:700;padding:14px 20px}
.composer button:hover,.action:hover{background:#6d80d5}
.hint{margin-top:9px;font-size:12px;color:#959aaf}.error{padding:9px 18px;color:#ffb9b9;background:#5c2c36;display:none}
.badge{border-radius:5px;background:#426c62;color:#d7ffed;font-size:9px;padding:2px 5px}
.admin-page{padding:36px;max-width:780px}.admin-page p{color:#afb5c7}
.hidden{display:none!important}
@media(max-width:780px){.app{grid-template-columns:55px minmax(0,1fr)}.sidebar{grid-column:1/-1;grid-row:2;min-height:120px}.main{grid-column:1/-1;grid-row:3}.rail{grid-column:1/-1;flex-direction:row;height:54px;padding:3px 12px}.mark{width:38px;height:38px;font-size:15px}.messages{min-height:50vh;padding:14px}.topbar,.composer{padding:14px}}
</style>
<script src="/_ui/client.js" defer></script>
</head>
<body>
<div class="app">
  <aside class="rail"><div class="mark" aria-label="Discord Mock">M</div><a href="/test" class="active">TEST</a><a href="/admin">ADMIN</a></aside>
  <aside class="sidebar">
    <header id="server-title" class="server-title">Mock Guild</header>
    <div class="minor">テキストチャンネル</div>
    <nav id="channels" class="channels" aria-label="チャンネル一覧"></nav>
    <div class="userpanel">
      <label for="identity">テスト用ダミーユーザー</label>
      <select id="identity" aria-label="ダミーユーザー選択"></select>
    </div>
  </aside>
  <main class="main" id="test-panel">
    <header class="topbar">
      <strong id="channel-title"># general</strong>
      <div class="presence"><span id="online-dot" class="dot"></span><span id="online-label">Bot 接続待機中</span></div>
    </header>
    <div id="error" role="alert" class="error"></div>
    <div id="messages" class="messages" role="log" aria-live="polite"></div>
    <div class="composer">
      <form id="message-form"><textarea id="message-input" maxlength="2000" required placeholder="メッセージを入力（Enter で送信、Shift+Enter で改行）"></textarea><button id="send" type="submit">送信</button></form>
      <p class="hint">選択したユーザーから MESSAGE_CREATE を Gateway 配信します。Bot の返信はここに反映されます。</p>
    </div>
  </main>
  <section id="admin-panel" class="admin-page hidden">
    <h2>管理画面</h2><p>現在のテスト用ユーザーとチャンネルはローカルで初期化されます。管理 API の認証は、テスト用ユーザーの切り替えとは分離されています。</p>
    <p>音声プロトコル・VC 再生、DM、権限ベースの管理 UI はまだ未実装です。</p><p><a href="/test">テスト画面に戻る</a></p>
  </section>
</div>
</body></html>\`;
}

/** Served from the same local origin; no inline JS or external CDN. */
export function renderBrowserScript(): string {
  return String.raw\`(() => {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const isAdmin = location.pathname === "/admin";
    $("test-panel").classList.toggle("hidden", isAdmin);
    $("admin-panel").classList.toggle("hidden", !isAdmin);
    const ui = {
      csrf: "",
      selectedUserId: "",
      selectedChannelId: "",
      current: null,
      events: null,
    };
    function showError(value) {
      $("error").textContent = value || "";
      $("error").style.display = value ? "block" : "none";
    }
    async function request(url, method = "GET", body = null) {
      const opts = { method, credentials: "same-origin", headers: {} };
      if (body !== null) {
        opts.headers["content-type"] = "application/json";
        opts.headers["x-discord-mock-csrf"] = ui.csrf;
        opts.body = JSON.stringify(body);
      }
      const response = await fetch(url, opts);
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(problem.message || "HTTP " + response.status);
      }
      return response.json();
    }
    function node(tag, className, value) {
      const e = document.createElement(tag);
      if (className) e.className = className;
      if (value != null) e.textContent = String(value);
      return e;
    }
    function setChannels(state) {
      const channels = $("channels");
      channels.replaceChildren();
      for (const c of state.guild.channels) {
        if (c.type !== 0) continue;
        const b = node("button", "channel" + (c.id === ui.selectedChannelId ? " selected" : ""), "#  " + c.name);
        b.type = "button";
        b.onclick = () => {
          ui.selectedChannelId = c.id;
          showState(state);
        };
        channels.append(b);
      }
    }
    function setUsers(state) {
      const identity = $("identity");
      const existing = [...identity.options].map((o) => o.value).join(",");
      const current = state.users.map((u) => u.id).join(",");
      if (existing !== current) {
        identity.replaceChildren(...state.users.map((u) => {
          const opt = node("option", "", u.username);
          opt.value = u.id;
          return opt;
        }));
      }
      identity.value = ui.selectedUserId;
    }
    function setMessages(state) {
      const channel = state.guild.channels.find((c) => c.id === ui.selectedChannelId);
      $("channel-title").textContent = "# " + (channel ? channel.name : "general");
      const target = $("messages");
      target.replaceChildren();
      const intro = node("div", "intro");
      intro.append(node("h2", "", "# " + (channel ? channel.name : "general")));
      intro.append(node("p", "", "ダミーユーザーの投稿は Bot へ配信されます。Bot からの投稿もここに表示されます。"));
      target.append(intro);
      const messages = state.messages[ui.selectedChannelId] || [];
      if (!messages.length) target.append(node("p", "empty", "まだメッセージはありません。最初の投稿を送信してください。"));
      for (const m of messages) {
        const item = node("article", "message");
        const avatar = node("div", "avatar" + (m.author.bot ? " bot" : ""), (m.author.username || "?").slice(0, 1).toUpperCase());
        const body = node("div", "");
        const meta = node("div", "meta");
        meta.append(node("strong", "", m.author.username));
        if (m.author.bot) meta.append(node("span", "badge", "BOT"));
        meta.append(node("time", "", new Date(m.timestamp).toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit"})));
        body.append(meta, node("div", "content", m.content));
        item.append(avatar, body);
        target.append(item);
      }
      target.scrollTop = target.scrollHeight;
    }
    function showState(state) {
      ui.current = state;
      ui.selectedUserId = state.selectedUserId;
      if (!state.guild.channels.some((c) => c.id === ui.selectedChannelId)) ui.selectedChannelId = state.guild.channels[0]?.id || "";
      $("server-title").textContent = state.guild.name;
      $("online-dot").classList.toggle("online", state.botConnections > 0);
      $("online-label").textContent = state.botConnections ? "Bot 接続中 (" + state.botConnections + ")" : "Bot 接続待機中";
      setChannels(state);
      setUsers(state);
      setMessages(state);
    }
    async function refresh() {
      try { showState(await request("/_ui/state")); showError(""); }
      catch (error) { showError(error.message); }
    }
    async function init() {
      try {
        const session = await request("/_ui/session");
        ui.csrf = session.csrf;
        ui.selectedUserId = session.selectedUserId;
        if (!isAdmin) {
          await refresh();
          const stream = new EventSource("/_ui/events");
          stream.addEventListener("changed", () => { void refresh(); });
          stream.onerror = () => { $("online-label").textContent = "再接続中…"; };
          ui.events = stream;
        }
      } catch (error) { showError(error.message); }
    }
    $("identity").onchange = async (e) => {
      try {
        const result = await request("/_ui/identity", "POST", { user_id: e.target.value });
        ui.selectedUserId = result.selectedUserId;
        await refresh();
      } catch (error) { showError(error.message); }
    };
    $("message-form").onsubmit = async (e) => {
      e.preventDefault();
      const content = $("message-input").value.trim();
      if (!content) return;
      $("send").disabled = true;
      try {
        await request("/_ui/messages", "POST", { channel_id: ui.selectedChannelId, content });
        $("message-input").value = "";
        await refresh();
      } catch (error) { showError(error.message); }
      finally { $("send").disabled = false; }
    };
    $("message-input").onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $("message-form").requestSubmit();
      }
    };
    void init();
  })();\`;
}
