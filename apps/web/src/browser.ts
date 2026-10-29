import type { BrowserCommand, BrowserState, IdentityResponse, SessionResponse } from "./types.js";
import { createElement, getElement } from "./dom.js";
import { DatabaseView } from "./database.js";
import { AdminPage } from "./admin.js";
import { MessageActions } from "./message-actions.js";
import { readMessageTarget, revealMessage } from "./message-links.js";
import { TestRunChatView, TestRunsView } from "./test-runs.js";

const elements = {
  testPanel: getElement("test-panel", "main"),
  adminPanel: getElement("admin-panel", "section"),
  error: getElement("error", "div"),
  channels: getElement("channels", "nav"),
  identity: getElement("identity", "select"),
  channelTitle: getElement("channel-title", "strong"),
  serverTitle: getElement("server-title", "header"),
  onlineDot: getElement("online-dot", "span"),
  onlineLabel: getElement("online-label", "span"),
  messages: getElement("messages", "div"),
  messageForm: getElement("message-form", "form"),
  messageInput: getElement("message-input", "textarea"),
  send: getElement("send", "button"),
  commandPicker: getElement("command-picker", "div"),
  commandSuggestions: getElement("command-suggestions", "div"),
  commandEmpty: getElement("command-empty", "p"),
};

const isTestChat = location.pathname === "/test";
const isAdmin = location.pathname === "/admin";
const isDatabase = location.pathname === "/database";
const isTestRuns = location.pathname === "/tests";
const ui = { csrf: "", selectedUserId: "", selectedChannelId: "" };
let messageActions: MessageActions;
let target = readMessageTarget();
let jumpPending = target !== null;
let latestState: BrowserState | null = null;
let identityChange: Promise<void> = Promise.resolve();
if (target) ui.selectedChannelId = target.channelId;
let commands: BrowserCommand[] = [];
let suggestions: BrowserCommand[] = [];
let activeSuggestion = 0;
let dismissedQuery: string | null = null;

function selectCommand(command: BrowserCommand): void {
  elements.messageInput.value = `/${command.name}`;
  dismissedQuery = elements.messageInput.value;
  renderCommandSuggestions();
  elements.messageInput.focus();
}

function renderCommandSuggestions(): void {
  const query = elements.messageInput.value;
  const match = /^\/([^\s]*)$/u.exec(query);
  const visible = match !== null && query !== dismissedQuery;
  elements.commandPicker.classList.toggle("hidden", !visible);
  elements.commandSuggestions.replaceChildren();
  elements.messageInput.removeAttribute("aria-activedescendant");
  suggestions = visible ? commands.filter((command) => command.name.startsWith(match[1].toLowerCase())) : [];
  elements.commandEmpty.classList.toggle("hidden", !visible || suggestions.length > 0);
  if (!visible || !suggestions.length) return;

  activeSuggestion = Math.min(activeSuggestion, suggestions.length - 1);
  for (const [index, command] of suggestions.entries()) {
    const selected = index === activeSuggestion;
    const button = createElement("button", selected ? "command-option selected" : "command-option");
    button.type = "button";
    button.id = `command-option-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = -1;
    button.onmousedown = (event) => event.preventDefault();
    button.append(createElement("strong", "", `/${command.name}`));
    button.append(createElement("span", "", command.description));
    button.onclick = () => selectCommand(command);
    elements.commandSuggestions.append(button);
    if (selected) elements.messageInput.setAttribute("aria-activedescendant", button.id);
  }
}

function handleSuggestionKey(event: KeyboardEvent): boolean {
  if (event.key === "Escape" && /^\//.test(elements.messageInput.value)) {
    dismissedQuery = elements.messageInput.value;
    renderCommandSuggestions();
    return true;
  }
  if (!suggestions.length) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const direction = event.key === "ArrowDown" ? 1 : -1;
    activeSuggestion = (activeSuggestion + direction + suggestions.length) % suggestions.length;
    renderCommandSuggestions();
    return true;
  }
  if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
    selectCommand(suggestions[activeSuggestion]);
    return true;
  }
  return false;
}

function showError(message: string): void {
  elements.error.textContent = message;
  elements.error.style.display = message ? "block" : "none";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function request<Result>(url: string, method = "GET", body: unknown = null): Promise<Result> {
  const headers: Record<string, string> = {};
  const options: RequestInit = { method, credentials: "same-origin", headers };
  if (body !== null) {
    headers["content-type"] = "application/json";
    headers["x-discord-mock-csrf"] = ui.csrf;
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => null);
    const message = problem && typeof problem === "object" && "message" in problem
      ? problem.message
      : undefined;
    throw new Error(typeof message === "string" && message ? message : `HTTP ${response.status}`);
  }
  return response.json() as Promise<Result>;
}

function renderChannels(state: BrowserState): void {
  elements.channels.replaceChildren();
  for (const channel of state.guild.channels) {
    if (channel.type !== 0) continue;
    const className = channel.id === ui.selectedChannelId ? "channel selected" : "channel";
    const button = createElement("button", className, `#  ${channel.name}`);
    button.type = "button";
    button.onclick = () => {
      target = null;
      jumpPending = false;
      location.hash = "";
      ui.selectedChannelId = channel.id;
      renderState(state);
    };
    elements.channels.append(button);
  }
}

function renderUsers(state: BrowserState): void {
  const existingIds = Array.from(elements.identity.options, (option) => option.value).join(",");
  const currentIds = state.users.map((user) => user.id).join(",");
  if (existingIds !== currentIds) {
    const options = state.users.map((user) => {
      const option = createElement("option", "", user.username);
      option.value = user.id;
      return option;
    });
    elements.identity.replaceChildren(...options);
  }
  elements.identity.value = ui.selectedUserId;
}


function renderMessages(state: BrowserState): void {
  const previousScroll = elements.messages.scrollTop;
  const channel = state.guild.channels.find((channel) => channel.id === ui.selectedChannelId);
  const title = `# ${channel?.name ?? "general"}`;
  elements.channelTitle.textContent = title;
  elements.messages.replaceChildren();

  const intro = createElement("div", "intro");
  intro.append(createElement("h2", "", title));
  intro.append(createElement("p", "", "ダミーユーザーの投稿は Bot へ配信されます。Bot からの投稿もここに表示されます。"));
  elements.messages.append(intro);

  const messages = state.messages[ui.selectedChannelId] ?? [];
  if (!messages.length) {
    elements.messages.append(createElement(
      "p",
      "empty",
      "まだメッセージはありません。最初の投稿を送信してください。 /コマンド名 でスラッシュコマンドも実行できます。",
    ));
  }
  elements.messages.append(...messages.map((message) => messageActions.render(message)));
  if (target) {
    elements.messages.scrollTop = previousScroll;
    if (revealMessage(target, jumpPending)) jumpPending = false;
    else showError("リンク先のメッセージは削除済み、または閲覧する権限がありません");
  } else elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderState(state: BrowserState): void {
  latestState = state;
  commands = state.commands;
  ui.selectedUserId = state.selectedUserId;
  if (!state.guild.channels.some((channel) => channel.id === ui.selectedChannelId)) {
    ui.selectedChannelId = state.guild.channels[0]?.id ?? "";
  }
  elements.serverTitle.textContent = state.guild.name;
  elements.onlineDot.classList.toggle("online", state.botConnections > 0);
  elements.onlineLabel.textContent = state.botConnections
    ? `Bot 接続中 (${state.botConnections})`
    : "Bot 接続待機中";
  renderChannels(state);
  renderUsers(state);
  renderMessages(state);
  renderCommandSuggestions();
}

async function refresh(): Promise<void> {
  try {
    showError("");
    renderState(await request<BrowserState>("/_ui/state"));
  } catch (error) {
    showError(errorMessage(error));
  }
}

async function switchIdentity(): Promise<void> {
  messageActions.close();
  try {
    const result = await request<IdentityResponse>("/_ui/identity", "POST", {
      user_id: elements.identity.value,
    });
    ui.selectedUserId = result.selectedUserId;
    await refresh();
  } catch (error) {
    showError(errorMessage(error));
  }
}

async function submitMessage(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (elements.send.disabled) return;
  const content = elements.messageInput.value.trim();
  if (!content) return;

  elements.send.disabled = true;
  try {
    if (content.startsWith("/")) {
      const command = commands.find((command) => `/${command.name}` === content);
      if (!command) throw new Error("一覧から登録済みのコマンドを選んでください。");
      await request("/_ui/interaction", "POST", { channel_id: ui.selectedChannelId, command_id: command.id });
    } else {
      await request("/_ui/messages", "POST", { channel_id: ui.selectedChannelId, content });
    }
    elements.messageInput.value = "";
    dismissedQuery = null;
    await refresh();
  } catch (error) {
    showError(errorMessage(error));
  } finally {
    elements.send.disabled = false;
  }
}

async function initialize(): Promise<void> {
  elements.testPanel.classList.toggle("hidden", isAdmin || isDatabase || isTestRuns);
  elements.adminPanel.classList.toggle("hidden", !isAdmin);
  getElement("database-panel", "main").classList.toggle("hidden", !isDatabase);
  getElement("channel-sidebar", "div").classList.toggle("hidden", isDatabase || isTestRuns);
  getElement("database-sidebar", "div").classList.toggle("hidden", !isDatabase);
  getElement("user-panel", "div").classList.toggle("hidden", isDatabase || isTestRuns);
  getElement("manual-composer", "div").classList.toggle("hidden", isTestChat);
  getElement("test-case-composer", "div").classList.toggle("hidden", !isTestChat);
  getElement("test-link", "a").classList.toggle("active", !isAdmin && !isDatabase && !isTestRuns);
  getElement("database-link", "a").classList.toggle("active", isDatabase);
  getElement("admin-link", "a").classList.toggle("active", isAdmin);
  getElement("tests-panel", "main").classList.toggle("hidden", !isTestRuns);
  getElement("tests-sidebar", "div").classList.toggle("hidden", !isTestRuns);
  getElement("tests-link", "a").classList.toggle("active", isTestRuns);
  for (const [id, active] of [["test-link", !isAdmin && !isDatabase && !isTestRuns], ["admin-link", isAdmin], ["database-link", isDatabase], ["tests-link", isTestRuns]] as const) {
    const link = getElement(id, "a");
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (isTestChat) {
    elements.serverTitle.textContent = "自動テスト";
    elements.channelTitle.textContent = "# general";
    elements.onlineLabel.textContent = "テスト結果を受信中";
    await new TestRunChatView().initialize();
    return;
  }
  if (isTestRuns) {
    elements.serverTitle.textContent = "自動テスト";
    await new TestRunsView().initialize();
    return;
  }
  if (isAdmin) {
    elements.serverTitle.textContent = "管理画面";
    await new AdminPage().initialize();
    return;
  }
  if (isDatabase) {
    elements.serverTitle.textContent = "データベース";
    await new DatabaseView().initialize();
    return;
  }
  messageActions = new MessageActions({
    csrf: () => ui.csrf, refresh, showError, beforeChange: () => identityChange,
  });
  addEventListener("hashchange", () => {
    target = readMessageTarget();
    jumpPending = target !== null;
    if (target) ui.selectedChannelId = target.channelId;
    if (latestState) { showError(""); renderState(latestState); }
  });
  elements.identity.onchange = () => { identityChange = switchIdentity(); };
  elements.messageForm.onsubmit = (event) => { void submitMessage(event); };
  elements.messageInput.oninput = () => {
    activeSuggestion = 0;
    dismissedQuery = null;
    renderCommandSuggestions();
  };
  elements.messageInput.onblur = () => {
    dismissedQuery = elements.messageInput.value;
    renderCommandSuggestions();
  };
  elements.messageInput.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && event.repeat) {
      event.preventDefault();
      return;
    }
    if (handleSuggestionKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.messageForm.requestSubmit();
    }
  };

  try {
    const session = await request<SessionResponse>("/_ui/session");
    ui.csrf = session.csrf;
    ui.selectedUserId = session.selectedUserId;
    if (isAdmin) return;

    await refresh();
    const stream = new EventSource("/_ui/events");
    stream.addEventListener("changed", () => { void refresh(); });
    stream.onerror = () => { elements.onlineLabel.textContent = "再接続中…"; };
  } catch (error) {
    showError(errorMessage(error));
  }
}

void initialize();
