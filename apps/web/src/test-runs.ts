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
