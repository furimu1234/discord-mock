import type {
  TestRunStatus,
  TestRunSummary,
  TestRunView,
} from "../../../packages/client-js/src/test-runs.js";
import { createElement, getElement } from "./dom.js";
import { TestCasePicker } from "./test-case-picker.js";
import { MessageActions } from "./message-actions.js";
import { firstMessage, messageFragment, messageLink, readMessageTarget, revealMessage, type MessageTarget } from "./message-links.js";

const STATUS: Record<TestRunStatus, string> = {
  running: "実行中",
  passed: "成功",
  failed: "失敗",
  cancelled: "中断",
};

/** 普段の app 上で、独立した UT の経過と表示用メッセージを確認する。 */
export class TestRunsView {
  private userCsrf = "";
  private readonly messageActions = new MessageActions({
    csrf: () => this.userCsrf,
    refresh: () => this.refresh(),
    showError: (message) => this.showError(new Error(message)),
  });
  private readonly elements = {
    runs: getElement("test-runs", "nav"),
    title: getElement("test-run-title", "strong"),
    status: getElement("test-run-status", "span"),
    steps: getElement("test-run-steps", "ol"),
    messages: getElement("test-run-messages", "div"),
    error: getElement("test-run-error", "div"),
    refresh: getElement("test-runs-refresh", "button"),
  };
  private selected = "";
  private followLatest = true;
  private generation = 0;

  async initialize(): Promise<void> {
    this.elements.refresh.onclick = () => {
      this.followLatest = true;
      void this.connect();
    };
    await this.connect();
    const stream = new EventSource("/_admin/test-runs/events");
    stream.addEventListener("open", () => {
      void this.refresh();
    });
    stream.addEventListener("changed", () => {
      void this.refresh();
    });
    stream.onerror = () => {
      this.showError(
        new Error("再接続中です。app の起動状態を確認してください。"),
      );
    };
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error(
        "テスト実行を読み込めません。app を確認して「最新を表示」を押してください。",
      );
    return response.json() as Promise<T>;
  }

  private async connect(): Promise<void> {
    try {
      await this.request("/_admin/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-mock-local": "1",
        },
        body: "{}",
      });
      const session = await this.request<{ csrf: string }>("/_ui/session");
      this.userCsrf = session.csrf;
      await this.refresh();
    } catch (error) {
      this.showError(error);
    }
  }

  private showError(error: unknown): void {
    this.elements.error.textContent =
      error instanceof Error ? error.message : "読み込みに失敗しました。";
    this.elements.error.style.display = "block";
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    try {
      const { runs } = await this.request<{ runs: TestRunSummary[] }>(
        "/_admin/test-runs",
      );
      if (generation !== this.generation) return;
      if (this.followLatest || !runs.some((run) => run.id === this.selected))
        this.selected = runs[0]?.id ?? "";
      this.elements.runs.replaceChildren();
      for (const run of runs) {
        const button = createElement(
          "button",
          run.id === this.selected
            ? "channel test-run selected"
            : "channel test-run",
        );
        button.type = "button";
        button.append(
          createElement(
            "span",
            `test-status ${run.status}`,
            STATUS[run.status],
          ),
          createElement("strong", "", run.name),
        );
        button.onclick = () => {
          this.selected = run.id;
          this.followLatest = false;
          void this.refresh();
        };
        this.elements.runs.append(button);
      }
      this.elements.error.textContent = "";
      this.elements.error.style.display = "none";
      if (!this.selected) {
        this.elements.title.textContent = "自動テスト";
        this.elements.status.textContent = "実行待ち";
        this.elements.steps.replaceChildren();
        this.elements.messages.replaceChildren(
          createElement(
            "p",
            "empty",
            "pnpm level:test:web で実行すると、ここに操作と返信が表示されます。",
          ),
        );
        return;
      }
      const run = await this.request<TestRunView>(
        `/_ui/test-runs/${this.selected}`,
      );
      if (generation !== this.generation) return;
      this.render(run);
    } catch (error) {
      if (generation === this.generation) this.showError(error);
    }
  }

  private render(run: TestRunView): void {
    const e = this.elements;
    e.title.textContent = run.name;
    e.status.textContent = STATUS[run.status];
    e.status.className = `test-status ${run.status}`;
    e.steps.replaceChildren(
      ...run.steps.map((step) => createElement("li", "", step.text)),
    );
    e.messages.replaceChildren();
    for (const channel of run.guild.channels) {
      if (channel.type !== 0) continue;
      const messages = run.messages[channel.id] ?? [];
      if (!messages.length) continue;
      e.messages.append(
        createElement("h2", "test-channel-title", `# ${channel.name}`),
        ...messages.map((message) => this.messageActions.render(message, run.id)),
      );
    }
    if (!e.messages.children.length)
      e.messages.append(
        createElement(
          "p",
          "empty",
          "メッセージはまだありません。上の一覧に実行の経過を表示します。",
        ),
      );
  }
}



/** /test のチャット欄に、独立した UT 全件の操作と返信を時系列表示する。 */
export class TestRunChatView {
  private readonly messages = getElement("messages", "div");
  private readonly identity = getElement("identity", "select");
  private readonly channels = getElement("channels", "nav");
  private readonly createChannelButton = getElement("channel-create", "button");
  private readonly createChannelForm = getElement("channel-create-form", "form");
  private readonly createChannelName = getElement("channel-create-name", "input");
  private readonly createChannelCancel = getElement("channel-create-cancel", "button");
  private readonly channelTitle = getElement("channel-title", "strong");
  private readonly logPanel = getElement("test-log-panel", "aside");
  private readonly logEntries = getElement("test-log-entries", "div");
  private readonly logTab = getElement("test-log-tab", "button");
  private readonly usersTab = getElement("test-users-tab", "button");
  private readonly usersList = getElement("test-user-list", "div");
  private readonly userProfile = getElement("test-user-profile", "div");
  private readonly userMenu = getElement("test-user-menu", "div");
  private readonly casePicker = new TestCasePicker(
    getElement("test-case-list", "div"), (id) => { void this.execute(id); },
  );
  private caseLaunching = false;
  private readonly status = getElement("test-case-status", "span");
  private readonly error = getElement("error", "div");
  private userCsrf = "";
  private sessionUsers: Array<{ id: string; username: string; bot: boolean }> = [];
  private sessionMembers: Array<{ user: { id: string }; roles: string[] }> = [];
  private sessionRoles: Array<{ id: string; name: string; color: number }> = [];
  private selectedUserId = "";
  private identityChange: Promise<void> = Promise.resolve();
  private identityError: string | null = null;
  private generation = 0;
  private selectedChannelId = "general";
  private runs: TestRunView[] = [];
  private appChannels: Array<{ id: string; name: string; type: number }> = [];
  private target = readMessageTarget();
  private jumpPending = this.target !== null;
  private runsLoaded = false;
  private readonly messageActions = new MessageActions({
    csrf: () => this.userCsrf,
    refresh: () => this.refreshRuns(),
    showError: (message) => this.showError(message),
    beforeChange: async () => { await this.identityChange; if (this.identityError) throw new Error(this.identityError); },
  });

  async initialize(): Promise<void> {
    this.logPanel.classList.toggle("hidden", false);
    if (this.target) this.selectedChannelId = this.target.channelId;
    addEventListener("hashchange", () => {
      this.target = readMessageTarget();
      this.jumpPending = this.target !== null;
      if (this.target) this.selectedChannelId = this.target.channelId;
      this.showError("");
      this.renderChannels();
      this.renderMessages();
    });
    this.logTab.onclick = () => this.selectSidebarTab("log");
    this.usersTab.onclick = () => this.selectSidebarTab("users");
    this.selectSidebarTab("log");
    this.createChannelButton.onclick = () => {
      this.createChannelForm.classList.toggle("hidden", false);
      this.createChannelName.focus();
    };
    this.createChannelCancel.onclick = () => this.createChannelForm.classList.toggle("hidden", true);
    this.createChannelForm.onsubmit = (event) => { event.preventDefault(); void this.createChannel(); };
    // pointerdown はclickより先に発火。別ユーザーのプロフィールを開く操作も妨げない。
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Node) || !this.userMenu.contains(target))
        this.userMenu.classList.toggle("hidden", true);
      if (!(target instanceof Node) || !this.userProfile.contains(target))
        this.userProfile.classList.toggle("hidden", true);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.userMenu.classList.toggle("hidden", true);
        this.userProfile.classList.toggle("hidden", true);
      }
    });
    this.render([]);
    try {
      await Promise.all([this.connectSession(), this.connectUserSession()]);
      await Promise.all([this.refreshCases(), this.refreshRuns(), this.refreshAppChannels()]);
      const appStream = new EventSource("/_ui/events");
      appStream.addEventListener("changed", () => { void this.refreshAppChannels(); void this.refreshRuns(); });
      const stream = new EventSource("/_admin/test-runs/events");
      stream.addEventListener("open", () => { void this.refreshRuns(); });
      stream.addEventListener("changed", () => {
        void this.refreshRuns();
        void this.refreshCases();
      });
      stream.onerror = () => {
        this.status.textContent = "テスト結果の再接続中…";
        // app 再起動で管理セッションが消えた場合は、開いているタブから再認証する。
        void this.connectSession().then(() => Promise.all([
          this.refreshCases(), this.refreshRuns(),
        ])).catch(() => {});
      };
      // プロセス起動失敗など SSE を発行できない場合も実行可能な状態へ戻す。
      setInterval(() => { void this.refreshCases(); }, 1500);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "初期化に失敗しました");
    }
  }

  private async connectSession(): Promise<void> {
    const response = await fetch("/_admin/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-discord-mock-local": "1" },
      body: "{}",
    });
    if (!response.ok) throw new Error("テスト参照セッションを開始できませんでした");
  }

  private async connectUserSession(): Promise<void> {
    const session = await this.request<{
      csrf: string;
      selectedUserId: string;
      users: { id: string; username: string; bot: boolean }[];
      members?: Array<{ user: { id: string }; roles: string[] }>;
      roles?: Array<{ id: string; name: string; color: number }>;
    }>("/_ui/session");
    this.userCsrf = session.csrf;
    this.sessionUsers = session.users.filter((user) => !user.bot);
    this.sessionMembers = session.members ?? [];
    this.sessionRoles = session.roles ?? [];
    this.selectedUserId = session.selectedUserId;
    this.identity.replaceChildren(...session.users.filter((user) => !user.bot).map((user) => {
      const option = createElement("option", "", user.username);
      option.value = user.id;
      return option;
    }));
    this.identity.value = session.selectedUserId;
    this.identity.onchange = () => { this.identityChange = this.switchIdentity(this.identity.value); };
    this.renderUserList();
  }

  private async switchIdentity(userId: string): Promise<void> {
    this.messageActions.close();
    this.identityError = null;
    try {
      const result = await this.request<{ selectedUserId: string }>("/_ui/identity", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-mock-csrf": this.userCsrf,
        },
        body: JSON.stringify({ user_id: userId }),
      });
      this.identity.value = result.selectedUserId;
      this.selectedUserId = result.selectedUserId;
      await Promise.all([this.refreshRuns(), this.refreshAppChannels()]);
      this.renderUserList();
      this.userMenu.classList.toggle("hidden", true);
      this.showError("");
    } catch (error) {
      this.identityError = error instanceof Error ? error.message : "ユーザーの切り替えに失敗しました";
      this.showError(this.identityError);
      await this.connectUserSession().catch(() => {});
    }
  }



  private async refreshAppChannels(): Promise<void> {
    try {
      const state = await this.request<{ guild: { channels: Array<{ id: string; name: string; type: number }> } }>("/_ui/state");
      this.appChannels = state.guild.channels.filter((channel) => channel.type === 0);
      this.renderChannels();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "チャンネル一覧を更新できませんでした");
    }
  }

  private async createChannel(): Promise<void> {
    const name = this.createChannelName.value.trim();
    if (!name) { this.showError("チャンネル名を入力してください"); return; }
    try {
      const channel = await this.request<{ id: string; name: string; type: number }>("/_ui/channels", {
        method: "POST",
        headers: { "content-type": "application/json", "x-discord-mock-csrf": this.userCsrf },
        body: JSON.stringify({ name }),
      });
      this.createChannelName.value = "";
      this.createChannelForm.classList.toggle("hidden", true);
      await this.refreshAppChannels();
      this.selectedChannelId = channel.id;
      this.renderChannels();
      this.renderMessages();
      this.showError("");
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "チャンネルの作成に失敗しました");
    }
  }

  private selectSidebarTab(tab: "log" | "users"): void {
    const usersVisible = tab === "users";
    this.logEntries.classList.toggle("hidden", usersVisible);
    this.usersList.classList.toggle("hidden", !usersVisible);
    this.logTab.classList.toggle("active", !usersVisible);
    this.usersTab.classList.toggle("active", usersVisible);
    this.logTab.setAttribute("aria-selected", String(!usersVisible));
    this.usersTab.setAttribute("aria-selected", String(usersVisible));
    this.userProfile.classList.toggle("hidden", true);
    this.userMenu.classList.toggle("hidden", true);
    if (!usersVisible && !this.target) this.logEntries.scrollTop = this.logEntries.scrollHeight;
  }

  private renderUserList(): void {
    this.usersList.replaceChildren();
    for (const user of this.sessionUsers) {
      const button = createElement(
        "button",
        user.id === this.selectedUserId ? "test-user-item logged-in" : "test-user-item",
      );
      button.type = "button";
      button.append(
        createElement("span", "test-user-avatar", user.username.slice(0, 1).toUpperCase()),
        createElement("span", "test-user-name", user.username),
      );
      if (user.id === this.selectedUserId)
        button.append(createElement("span", "test-user-current", "ログイン中"));
      button.onclick = () => this.showUserProfile(user);
      button.oncontextmenu = (event) => {
        event.preventDefault();
        this.showUserMenu(user);
      };
      this.usersList.append(button);
    }
  }

  private showUserProfile(user: { id: string; username: string }): void {
    this.userMenu.classList.toggle("hidden", true);
    const profile = this.userProfile;
    const close = createElement("button", "test-profile-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "プロフィールを閉じる");
    close.onclick = () => profile.classList.toggle("hidden", true);
    const header = createElement("div", "test-profile-header");
    header.append(
      createElement("span", "test-profile-avatar", user.username.slice(0, 1).toUpperCase()),
      createElement("strong", "test-profile-name", user.username),
      close,
    );
    const member = this.sessionMembers.find((item) => item.user.id === user.id);
    const assigned = new Set(member?.roles ?? []);
    const roles = this.sessionRoles.filter((role) => role.name === "@everyone" || assigned.has(role.id));
    const roleList = createElement("div", "test-profile-roles");
    roleList.append(...roles.map((role) => {
      const badge = createElement("span", "test-profile-role", role.name);
      if (role.color) badge.style.borderColor = `#${role.color.toString(16).padStart(6, "0")}`;
      return badge;
    }));
    profile.replaceChildren(
      header,
      createElement("div", "test-profile-id", `ID: ${user.id}`),
      createElement("strong", "", "ロール"),
      roleList,
    );
    profile.classList.toggle("hidden", false);
  }

  private showUserMenu(user: { id: string; username: string }): void {
    this.userProfile.classList.toggle("hidden", true);
    const change = createElement("button", "", "このユーザーでログイン");
    change.type = "button";
    change.onclick = () => {
      this.identityChange = this.switchIdentity(user.id);
    };
    const copy = createElement("button", "", "ユーザーIDをコピー");
    copy.type = "button";
    copy.onclick = () => {
      void navigator.clipboard.writeText(user.id).then(
        () => this.userMenu.classList.toggle("hidden", true),
        () => this.showError("IDをコピーできませんでした"),
      );
    };
    this.userMenu.replaceChildren(change, copy);
    this.userMenu.classList.toggle("hidden", false);
  }

  private showError(message: string): void {
    this.error.textContent = message;
    this.error.style.display = message ? "block" : "none";
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(path, { credentials: "same-origin", ...options });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = body && typeof body === "object" && "message" in body ? body.message : undefined;
      throw new Error(typeof error === "string" ? error : `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private async refreshCases(): Promise<void> {
    try {
      const result = await this.request<{
        cases: { id: string; name: string }[];
        runningId: string | null;
        error: string | null;
      }>("/_admin/test-cases");
      const running = result.runningId !== null || this.caseLaunching;
      this.casePicker.update(result.cases, running);
      this.status.textContent = result.runningId
        ? "テスト実行中…"
        : result.error ?? `${result.cases.length} 件のテストケース`;
    } catch {
      this.casePicker.setDisabled(true);
      this.status.textContent = "テストケース一覧を取得できません（pnpm app を確認）";
    }
  }

  private async execute(id: string): Promise<void> {
    if (this.caseLaunching || this.casePicker.disabled) return;
    this.caseLaunching = true;
    this.casePicker.setDisabled(true);
    this.showError("");
    this.status.textContent = "テストを開始しています…";
    try {
      // ユーザー切替 POST とテスト起動 POST が競合しないよう順番に実行する。
      await this.identityChange;
      if (this.identityError) throw new Error(this.identityError);
      await this.request("/_ui/test-cases/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-mock-csrf": this.userCsrf,
        },
        body: JSON.stringify({ id }),
      });
      this.resumeFollowing();
      this.render(this.runs);
      await this.refreshCases();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "テストを開始できませんでした");
    } finally {
      this.caseLaunching = false;
      await this.refreshCases();
    }
  }

  private async refreshRuns(): Promise<void> {
    const generation = ++this.generation;
    try {
      const { runs } = await this.request<{ runs: TestRunSummary[] }>("/_admin/test-runs");
      const details = await Promise.all(runs.map((run) =>
        this.request<TestRunView>(`/_ui/test-runs/${run.id}`),
      ));
      if (generation !== this.generation) return;
      const hadRuns = this.runsLoaded;
      this.runsLoaded = true;
      this.render(details.reverse(), hadRuns);
    } catch (error) {
      if (generation === this.generation)
        this.showError(error instanceof Error ? error.message : "テストの更新に失敗しました");
    }
  }

  private render(runs: TestRunView[], followActivity = false): void {
    // 初回のURL表示や単なる再取得ではリンク先を保持し、テストの新しい進捗で追従を再開する。
    if (followActivity) {
      const changed = [...runs].reverse().find((run) => {
        const previous = this.runs.find((item) => item.id === run.id);
        if (!previous) return true;
        if (previous.status !== "running") return false;
        const previousMessages = new Set(Object.values(previous.messages).flat().map((message) => `${message.channel_id}/${message.id}`));
        return run.updatedAt !== previous.updatedAt || run.status !== previous.status ||
          run.step !== previous.step || run.steps.length !== previous.steps.length ||
          Object.values(run.messages).flat().some((message) => !previousMessages.has(`${message.channel_id}/${message.id}`));
      });
      if (changed) this.resumeFollowing(changed);
    }
    this.runs = runs;
    this.showError("");
    this.renderChannels();
    this.renderMessages();
    this.renderLog();
  }

  private resumeFollowing(run?: TestRunView): void {
    this.target = null;
    this.jumpPending = false;
    if (location.hash) location.hash = "";
    const latest = run && Object.values(run.messages).flat()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1);
    if (latest) this.selectedChannelId = latest.channel_id;
  }

  private renderChannels(): void {
    // 初期描画ではUT専用チャンネルが未取得でも、リンク先の選択を後続の描画へ引き継ぐ。
    if (this.target && this.jumpPending) this.selectedChannelId = this.target.channelId;
    const channels = new Map<string, string>();
    for (const channel of this.appChannels) channels.set(channel.id, channel.name);
    for (const run of this.runs) {
      for (const channel of run.guild.channels) {
        if (channel.type === 0 && !channels.has(channel.id)) channels.set(channel.id, channel.name);
      }
    }
    // 初回は報告スナップショットがないため、既定チャンネルを表示する。
    if (channels.size === 0) channels.set("general", "general");
    if (!channels.has(this.selectedChannelId)) {
      this.selectedChannelId = channels.keys().next().value ?? "general";
    }
    this.channels.replaceChildren();
    for (const [id, name] of channels) {
      const button = createElement(
        "button",
        id === this.selectedChannelId ? "channel selected" : "channel",
        `#  ${name}`,
      );
      button.type = "button";
      button.onclick = () => {
        this.target = null;
        this.jumpPending = false;
        location.hash = "";
        this.selectedChannelId = id;
        this.renderChannels();
        this.renderMessages();
      };
      this.channels.append(button);
    }
    this.channelTitle.textContent = `# ${channels.get(this.selectedChannelId) ?? "general"}`;
  }

  private renderMessages(): void {
    const previousScroll = this.messages.scrollTop;
    this.messages.replaceChildren();

    const name = (this.channelTitle.textContent ?? "").replace(/^#\s*/, "");
    const welcome = createElement("section", "test-chat-welcome");
    welcome.append(
      createElement("div", "test-chat-symbol", "#"),
      createElement("h2", "", `# ${name}へようこそ！`),
      createElement(
        "p",
        "",
        `ここはテスト用チャンネル「#${name}」の始まりです。テストケースを実行するとユーザーの投稿と Bot の返信が表示されます。`,
      ),
    );
    this.messages.append(welcome);

    // チャットにはダミーユーザーと Bot の実メッセージのみ。検証ログは別枠。
    for (const run of this.runs) {
      const items = [...(run.messages[this.selectedChannelId] ?? [])];
      items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      this.messages.append(...items.map((message) => this.messageActions.render(message, run.id)));
    }
    // リンク先の閲覧中は位置を保ち、テストの進捗を受けたら最新の投稿へ追従する。
    if (this.target) {
      this.messages.scrollTop = previousScroll;
      if (revealMessage(this.target, this.jumpPending)) this.jumpPending = false;
      else if (this.runsLoaded) this.showError("リンク先のメッセージは削除済み、期限切れ、または閲覧する権限がありません");
    } else this.messages.scrollTop = this.messages.scrollHeight;
  }

  private renderLog(): void {
    const previousScroll = this.logEntries.scrollTop;
    this.logEntries.replaceChildren();
    if (!this.runs.length) {
      this.logEntries.append(createElement(
        "p",
        "test-log-empty",
        "まだ実行ログはありません。下のテストケースを選ぶと、開始・検証ステップ・結果がここに表示されます。",
      ));
      return;
    }
    for (const run of this.runs) {
      const first = firstMessage(run);
      const card = createElement(first ? "a" : "section", "test-log-run");
      if (first) {
        card.setAttribute("href", messageLink(first));
        card.setAttribute("aria-label", `${run.name}の最初のメッセージへ移動`);
        card.onclick = (event) => { event.preventDefault(); this.jumpTo(first); };
      }
      const heading = createElement("div", "test-log-run-heading");
      heading.append(
        createElement("strong", "", run.name),
        createElement("span", `test-status ${run.status}`, STATUS[run.status]),
      );
      const started = createElement("div", "test-log-run-time", new Date(run.startedAt).toLocaleTimeString("ja-JP"));
      const steps = createElement("ol", "test-log-steps");
      steps.append(...run.steps.map((step) => createElement("li", "", step.text)));
      card.append(heading, started, steps);
      if (run.status !== "running") {
        card.append(createElement("p", `test-log-result test-status ${run.status}`, `結果: ${STATUS[run.status]}`));
      }
      this.logEntries.append(card);
    }
    this.logEntries.scrollTop = this.target ? previousScroll : this.logEntries.scrollHeight;
  }

  private jumpTo(target: MessageTarget): void {
    this.target = target;
    this.jumpPending = true;
    this.selectedChannelId = target.channelId;
    location.hash = messageFragment(target);
    this.showError("");
    this.renderChannels();
    this.renderMessages();
  }
}
