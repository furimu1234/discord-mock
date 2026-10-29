import { initializeWindowFrame } from "./window-frame.ts";
import {
  TerminalModel,
  type LogEntry,
  type LogStream,
  type TerminalLine,
} from "./terminal-model.ts";
import type { TerminalStyle } from "./terminal-output.ts";

interface TerminalBridge {
  history(): Promise<LogEntry[]>;
  onLog(callback: (entry: LogEntry) => void): () => void;
  status(): Promise<{
    running: boolean;
    pid?: number;
    connecting?: boolean;
    url?: string;
  }>;
  copy(text: string): Promise<void>;
}
declare global {
  interface Window {
    discordMockTerminal?: TerminalBridge;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`表示要素がありません: ${id}`);
  return found as T;
}
function paint(span: HTMLElement, style: TerminalStyle): void {
  const foreground = style.inverse
    ? (style.background ?? "#101722")
    : style.foreground;
  const background = style.inverse
    ? (style.foreground ?? "#d8e3f1")
    : style.background;
  if (foreground) span.style.color = foreground;
  if (background) span.style.backgroundColor = background;
  if (style.bold) span.style.fontWeight = "700";
  if (style.dim) span.style.opacity = "0.62";
  if (style.italic) span.style.fontStyle = "italic";
  span.style.textDecoration = [
    style.underline ? "underline" : "",
    style.strike ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
function timestamp(time: string): string {
  return new Date(time).toLocaleTimeString("ja-JP", { hour12: false });
}
function renderLine(line: TerminalLine): HTMLElement {
  const row = document.createElement("div");
  row.className = `log-row log-${line.stream}`;
  row.dataset.lineId = String(line.id);
  const time = document.createElement("time");
  time.className = "log-time";
  time.dateTime = line.time;
  time.textContent = timestamp(line.time);
  const source = document.createElement("span");
  source.className = "log-source";
  source.textContent = line.stream;
  const message = document.createElement("span");
  message.className = "log-message";
  for (const segment of line.segments) {
    const span = document.createElement("span");
    span.textContent = segment.text;
    paint(span, segment.style);
    message.append(span);
  }
  row.append(time, source, message);
  return row;
}

initializeWindowFrame();
const bridge = window.discordMockTerminal;
if (bridge) {
  const model = new TerminalModel();
  const output = element("output");
  const empty = element("empty-state");
  const search = element<HTMLInputElement>("search");
  const follow = element<HTMLButtonElement>("follow");
  const latest = element<HTMLButtonElement>("latest");
  const feedback = element("feedback");
  const filters = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-stream]"),
  );
  const rows = new Map<number, { revision: number; row: HTMLElement }>();
  let stream: LogStream | "all" = "all";
  let query = "";
  let following = true;
  let unread = 0;
  let frame: number | undefined;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const visible = () =>
    model.lines.filter(
      (line) =>
        (stream === "all" || line.stream === stream) &&
        (!query || line.text.toLocaleLowerCase().includes(query)),
    );
  const updateFollow = () => {
    follow.setAttribute("aria-pressed", String(following));
    follow.title = following
      ? "新しいログへ自動でスクロールしています"
      : "自動スクロールを再開";
    latest.hidden = following || unread === 0;
    latest.textContent = `↓ 新しいログ ${unread}件`;
  };
  const render = () => {
    frame = undefined;
    const ids = new Set(model.lines.map((line) => line.id));
    for (const [id, cached] of rows)
      if (!ids.has(id)) {
        cached.row.remove();
        rows.delete(id);
      }
    const matches = visible();
    const matching = new Set(matches.map((line) => line.id));
    for (const line of model.lines) {
      const cached = rows.get(line.id);
      if (!cached || cached.revision !== line.revision) {
        const row = renderLine(line);
        if (cached) cached.row.replaceWith(row);
        else output.append(row);
        rows.set(line.id, { revision: line.revision, row });
      }
      const row = rows.get(line.id)?.row;
      if (row) row.hidden = !matching.has(line.id);
    }
    for (const filter of filters) {
      const kind = filter.dataset.stream;
      const count = filter.querySelector(".count");
      if (count)
        count.textContent = String(
          kind === "all"
            ? model.lines.length
            : model.lines.filter((line) => line.stream === kind).length,
        );
      filter.setAttribute("aria-pressed", String(kind === stream));
    }
    element("line-count").textContent = `${matches.length.toLocaleString()} 行`;
    element("retained-count").textContent =
      `${model.lines.length.toLocaleString()} / 1,000 行`;
    empty.hidden = matches.length > 0;
    element("empty-title").textContent = model.lines.length
      ? "一致するログがありません"
      : "ログを待っています";
    element("empty-description").textContent = model.lines.length
      ? "検索語や出力元のフィルターを変更してください。"
      : "管理画面で Bot を起動すると、ここに出力が表示されます。";
    if (following) {
      output.scrollTop = output.scrollHeight;
      unread = 0;
    }
    updateFollow();
  };
  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(render);
  };
  const notice = (text: string) => {
    feedback.textContent = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedback.textContent = "";
    }, 3500);
  };
  let loading = true;
  const waiting: LogEntry[] = [];
  const receive = (entry: LogEntry) => {
    model.append(entry);
    if (!following) unread++;
    schedule();
  };
  const unsubscribe = bridge.onLog((entry) => {
    if (loading) waiting.push(entry);
    else receive(entry);
  });
  void bridge
    .history()
    .then((history) => {
      for (const entry of [...history, ...waiting].sort((a, b) => a.id - b.id))
        model.append(entry);
    })
    .catch(() => {
      for (const entry of waiting) model.append(entry);
      notice("過去のログを読み込めませんでした");
    })
    .finally(() => {
      loading = false;
      waiting.length = 0;
      schedule();
    });

  for (const filter of filters)
    filter.onclick = () => {
      stream = filter.dataset.stream as LogStream | "all";
      schedule();
    };
  search.oninput = () => {
    query = search.value.trim().toLocaleLowerCase();
    schedule();
  };
  follow.onclick = () => {
    following = !following;
    if (following) unread = 0;
    schedule();
  };
  latest.onclick = () => {
    following = true;
    unread = 0;
    schedule();
  };
  output.addEventListener(
    "scroll",
    () => {
      if (
        following &&
        output.scrollHeight - output.scrollTop - output.clientHeight > 48
      ) {
        following = false;
        updateFollow();
      }
    },
    { passive: true },
  );
  element<HTMLButtonElement>("clear").onclick = () => {
    model.clear();
    unread = 0;
    schedule();
    notice("表示中のログをクリアしました");
  };
  element<HTMLButtonElement>("copy").onclick = () => {
    const text = visible()
      .map((line) => `[${timestamp(line.time)}] [${line.stream}] ${line.text}`)
      .join("\n");
    if (!text) {
      notice("コピーするログがありません");
      return;
    }
    void bridge.copy(text).then(
      () => notice("表示中のログをコピーしました"),
      () =>
        notice("コピーできませんでした。ログを絞り込んで再度お試しください"),
    );
  };
  addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      search.focus();
      search.select();
    }
    if (event.key === "Escape" && document.activeElement === search) {
      search.value = "";
      query = "";
      schedule();
    }
  });
  const status = element("process-state");
  const detail = element("process-detail");
  const refreshStatus = async () => {
    try {
      const state = await bridge.status();
      status.dataset.state = state.running
        ? state.connecting
          ? "connecting"
          : "running"
        : "idle";
      element("process-label").textContent = state.running
        ? state.connecting
          ? "接続中"
          : "実行中"
        : "待機中";
      detail.textContent = state.running
        ? `${state.url ?? "Bot プロセス"}  ·  PID ${state.pid}`
        : "管理画面から Bot を起動できます";
    } catch {
      detail.textContent = "起動状態を取得できませんでした";
    }
  };
  void refreshStatus();
  const statusTimer = setInterval(() => {
    void refreshStatus();
  }, 1000);
  addEventListener(
    "pagehide",
    () => {
      unsubscribe();
      clearInterval(statusTimer);
      clearTimeout(feedbackTimer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    },
    { once: true },
  );
  render();
}
