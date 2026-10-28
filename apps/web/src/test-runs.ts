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
  private readonly buttons = getElement("test-case-buttons", "div");
  private readonly status = getElement("test-case-status", "span");
  private readonly error = getElement("error", "div");
  private csrf = "";
  private generation = 0;

  async initialize(): Promise<void> {
    this.messages.replaceChildren(createElement("p", "empty", "テストケースのボタンまたは pnpm bot で実行してください。"));
    try {
      await this.connectSession();
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
    const session = await response.json() as { csrf: string };
    this.csrf = session.csrf;
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
      await this.request("/_admin/test-cases/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-mock-admin-csrf": this.csrf,
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
    const wasAtBottom = this.messages.scrollTop + this.messages.clientHeight >= this.messages.scrollHeight - 60;
    this.messages.replaceChildren();
    if (!runs.length) {
      this.messages.append(createElement("p", "empty", "実行待機中。下のテストケースを選ぶか pnpm bot で全テストを実行してください。"));
      return;
    }
    for (const run of runs) {
      const heading = createElement("div", "test-run-heading");
      heading.append(
        createElement("strong", "", run.name),
        createElement("span", `test-status ${run.status}`, STATUS[run.status]),
        createElement("time", "", new Date(run.startedAt).toLocaleTimeString("ja-JP")),
      );
      this.messages.append(heading);
      type RunEntry =
        | { kind: "step"; timestamp: string; text: string }
        | { kind: "message"; timestamp: string; channel: string; message: TestRunView["messages"][string][number] };
      const entries: RunEntry[] = run.steps.map(({ text, timestamp }) => ({ kind: "step", text, timestamp }));
      for (const channel of run.guild.channels) {
        for (const message of run.messages[channel.id] ?? [])
          entries.push({ kind: "message", channel: channel.name, timestamp: message.timestamp, message });
      }
      entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      let currentChannel = "";
      for (const entry of entries) {
        if (entry.kind === "step") {
          this.messages.append(createElement("div", "test-run-step", entry.text));
        } else {
          if (currentChannel !== entry.channel) {
            currentChannel = entry.channel;
            this.messages.append(createElement("div", "test-run-channel", `# ${currentChannel}`));
          }
          this.messages.append(renderMessage(entry.message));
        }
      }
      if (run.status !== "running")
        this.messages.append(createElement("div", `test-run-step test-run-final test-status ${run.status}`, `結果: ${STATUS[run.status]}`));
    }
    if (wasAtBottom) this.messages.scrollTop = this.messages.scrollHeight;
    this.showError("");
  }
}
