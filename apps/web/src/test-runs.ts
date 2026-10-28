import type {
  TestRunStatus,
  TestRunSummary,
  TestRunView,
} from "../../../packages/client-js/src/test-runs.js";
import { createElement, getElement } from "./dom.js";
import { renderMessage } from "./message.js";

const STATUS: Record<TestRunStatus, string> = {
  running: "実行中",
  passed: "成功",
  failed: "失敗",
  cancelled: "中断",
};

/** 普段の app 上で、独立した UT の経過を読み取り専用で表示する。 */
export class TestRunsView {
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
        `/_admin/test-runs/${this.selected}`,
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
        ...messages.map(renderMessage),
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
  private readonly channelTitle = getElement("channel-title", "strong");
  private readonly logPanel = getElement("test-log-panel", "aside");
  private readonly logEntries = getElement("test-log-entries", "div");
  private readonly buttons = getElement("test-case-buttons", "div");
  private readonly status = getElement("test-case-status", "span");
  private readonly error = getElement("error", "div");
  private userCsrf = "";
  private identityChange: Promise<void> = Promise.resolve();
  private identityError: string | null = null;
  private generation = 0;
  private selectedChannelId = "general";
  private runs: TestRunView[] = [];

  async initialize(): Promise<void> {
    this.logPanel.classList.toggle("hidden", false);
    this.render([]);
    try {
      await Promise.all([this.connectSession(), this.connectUserSession()]);
      await Promise.all([this.refreshCases(), this.refreshRuns()]);
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
      // プロセス起動失敗など SSE を発行できない場合もボタン状態を戻す。
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
    }>("/_ui/session");
    this.userCsrf = session.csrf;
    this.identity.replaceChildren(...session.users.filter((user) => !user.bot).map((user) => {
      const option = createElement("option", "", user.username);
      option.value = user.id;
      return option;
    }));
    this.identity.value = session.selectedUserId;
    this.identity.onchange = () => { this.identityChange = this.switchIdentity(); };
  }

  private async switchIdentity(): Promise<void> {
    const userId = this.identity.value;
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
      this.showError("");
    } catch (error) {
      this.identityError = error instanceof Error ? error.message : "ユーザーの切り替えに失敗しました";
      this.showError(this.identityError);
      await this.connectUserSession().catch(() => {});
    }
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
      this.buttons.replaceChildren();
      for (const item of result.cases) {
        const button = createElement("button", "test-case-button", item.name);
        button.type = "button";
        button.disabled = result.runningId !== null;
        if (result.runningId === item.id) button.classList.add("running");
        button.onclick = () => { void this.execute(item.id); };
        this.buttons.append(button);
      }
      this.status.textContent = result.runningId
        ? "テスト実行中…"
        : result.error ?? `${result.cases.length} 件のテストケース`;
    } catch {
      this.status.textContent = "テストボタンの取得に失敗（pnpm app を確認）";
    }
  }

  private async execute(id: string): Promise<void> {
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
      await this.refreshCases();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "テストを開始できませんでした");
      await this.refreshCases();
    }
  }

  private async refreshRuns(): Promise<void> {
    const generation = ++this.generation;
    try {
      const { runs } = await this.request<{ runs: TestRunSummary[] }>("/_admin/test-runs");
      const details = await Promise.all(runs.map((run) =>
        this.request<TestRunView>(`/_admin/test-runs/${run.id}`),
      ));
      if (generation !== this.generation) return;
      this.render(details.reverse());
    } catch (error) {
      if (generation === this.generation)
        this.showError(error instanceof Error ? error.message : "テストの更新に失敗しました");
    }
  }

  private render(runs: TestRunView[]): void {
    this.runs = runs;
    this.renderChannels();
    this.renderMessages();
    this.renderLog();
    this.showError("");
  }

  private renderChannels(): void {
    const channels = new Map<string, string>();
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
        this.selectedChannelId = id;
        this.renderChannels();
        this.renderMessages();
      };
      this.channels.append(button);
    }
    this.channelTitle.textContent = `# ${channels.get(this.selectedChannelId) ?? "general"}`;
  }

  private renderMessages(): void {
    const wasAtBottom = this.messages.scrollTop + this.messages.clientHeight >= this.messages.scrollHeight - 60;
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
      this.messages.append(...items.map(renderMessage));
    }
    if (wasAtBottom) this.messages.scrollTop = this.messages.scrollHeight;
  }

  private renderLog(): void {
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
      const card = createElement("section", "test-log-run");
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
  }
}
