import type { DatabasePage, DatabaseTable } from "../../server/src/database.js";
import { createElement, getElement } from "./dom.js";

interface AdminSession {
  authenticated: boolean;
  databaseAvailable: boolean;
}

class AccessExpired extends Error {}

/** Local read-only DB access uses its own cookie, independent of dummy users. */
export class DatabaseView {
  private readonly elements = {
    title: getElement("database-title", "strong"),
    error: getElement("database-error", "div"),
    notice: getElement("database-notice", "div"),
    noticeText: getElement("database-notice-text", "p"),
    retry: getElement("database-retry", "button"),
    content: getElement("database-content", "section"),
    tables: getElement("database-tables", "nav"),
    search: getElement("database-search", "input"),
    source: getElement("database-source", "select"),
    refresh: getElement("database-refresh", "button"),
    grid: getElement("database-grid", "div"),
    status: getElement("database-status", "div"),
    count: getElement("database-count", "span"),
    limit: getElement("database-limit", "select"),
    prev: getElement("database-prev", "button"),
    next: getElement("database-next", "button"),
  };
  private tables: DatabaseTable[] = [];
  private selectedRunId: string | null = null;
  private selected: DatabaseTable | undefined;
  private offset = 0;
  private sort = "";
  private direction: "asc" | "desc" = "asc";
  private generation = 0;
  private pending: AbortController | undefined;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  async initialize(): Promise<void> {
    const e = this.elements;
    e.refresh.onclick = () => { void this.run(() => this.connect()); };
    e.source.onchange = () => {
      this.selectedRunId = e.source.value;
      this.offset = 0;
      this.sort = "";
      e.search.value = "";
      void this.run(() => this.loadTables());
    };
    e.retry.onclick = () => { void this.run(() => this.connect()); };
    e.search.oninput = () => {
      clearTimeout(this.searchTimer);
      this.cancel();
      this.searchTimer = setTimeout(() => { this.offset = 0; void this.run(() => this.loadRows()); }, 250);
    };
    e.limit.onchange = () => { this.offset = 0; void this.run(() => this.loadRows()); };
    e.prev.onclick = () => { this.offset = Math.max(0, this.offset - Number(e.limit.value)); void this.run(() => this.loadRows()); };
    e.next.onclick = () => { this.offset += Number(e.limit.value); void this.run(() => this.loadRows()); };
    await this.run(() => this.connect());
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options, credentials: "same-origin",
      headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
    });
    if (response.status === 401 || response.status === 403) throw new AccessExpired("ローカル接続を確認して、再読み込みしてください。");
    if (!response.ok) throw new Error("データベースを読み込めませんでした。app の起動状態を確認して、更新してください。");
    return response.json() as Promise<T>;
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.showError("");
    try { await action(); }
    catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (error instanceof AccessExpired) this.clear();
      this.showError(error instanceof Error ? error.message : "読み込みに失敗しました。");
    }
  }

  private showError(message: string): void {
    this.elements.error.textContent = message;
    this.elements.error.style.display = message ? "block" : "none";
  }

  private async connect(): Promise<void> {
    const session = await this.request<AdminSession>("/_admin/session", {
      method: "POST", headers: { "x-discord-mock-local": "1" }, body: "{}",
    });
    if (!session.databaseAvailable) {
      this.clear();
      this.elements.noticeText.textContent = "この環境には DB が接続されていません。DB を使用するテストクライアントを起動してください。";
      return;
    }
    if (!session.authenticated) throw new AccessExpired("ローカル接続を確認して、再読み込みしてください。");
    this.elements.notice.classList.toggle("hidden", true);
    this.elements.content.classList.toggle("hidden", false);
    await this.loadSources();
    await this.loadTables();
  }

  /** App DB and test DBs remain separate; run IDs select only persisted read-only snapshots. */
  private async loadSources(): Promise<void> {
    const response = await this.request<{
      runs: Array<{ id: string; name: string; hasDatabase?: boolean }>;
    }>("/_admin/test-runs");
    const tests = response.runs.filter((run) => run.hasDatabase);
    if (this.selectedRunId === null) this.selectedRunId = tests[0]?.id ?? "";
    if (this.selectedRunId && !tests.some((run) => run.id === this.selectedRunId))
      this.selectedRunId = tests[0]?.id ?? "";
    const options = [createElement("option", "", "AppのDB")];
    options[0].value = "";
    for (const run of tests) {
      const option = createElement("option", "", `テスト: ${run.name}`);
      option.value = run.id;
      options.push(option);
    }
    this.elements.source.replaceChildren(...options);
    this.elements.source.value = this.selectedRunId;
  }

  private databaseUrl(path: string): string {
    return this.selectedRunId
      ? `${path}${path.includes("?") ? "&" : "?"}runId=${encodeURIComponent(this.selectedRunId)}`
      : path;
  }

  private cancel(): void {
    this.generation++;
    this.pending?.abort();
    this.pending = undefined;
  }

  private clear(): void {
    this.cancel();
    clearTimeout(this.searchTimer);
    this.tables = [];
    this.selected = undefined;
    this.selectedRunId = null;
    this.offset = 0;
    this.sort = "";
    const e = this.elements;
    e.search.value = "";
    e.source.replaceChildren();
    e.tables.replaceChildren();
    e.grid.replaceChildren();
    e.status.textContent = "";
    e.count.textContent = "";
    e.title.textContent = "データベース";
    e.noticeText.textContent = "再読み込みして DB に接続してください。";
    e.notice.classList.toggle("hidden", false);
    e.content.classList.toggle("hidden", true);
  }

  private async loadTables(): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const result = await this.request<{ tables: DatabaseTable[] }>(this.databaseUrl("/_admin/database/tables"));
    if (generation !== this.generation) return;
    this.tables = result.tables;
    const previous = this.selected;
    this.selected = this.tables.find((table) => table.schema === previous?.schema && table.name === previous.name) ?? this.tables[0];
    if (this.selected?.schema !== previous?.schema || this.selected?.name !== previous?.name) {
      this.sort = "";
      this.offset = 0;
      this.elements.search.value = "";
    }
    this.renderTables();
    await this.loadRows();
  }

  private renderTables(): void {
    this.elements.tables.replaceChildren();
    let schema = "";
    for (const table of this.tables) {
      if (schema !== table.schema) {
        schema = table.schema;
        this.elements.tables.append(createElement("div", "database-schema", schema));
      }
      const button = createElement("button", table === this.selected ? "database-table selected" : "database-table");
      button.type = "button";
      button.append(createElement("span", "table-symbol", "▤"), createElement("span", "table-name", table.name), createElement("small", "", String(table.columnCount)));
      button.onclick = () => {
        this.selected = table;
        this.offset = 0;
        this.sort = "";
        this.elements.search.value = "";
        clearTimeout(this.searchTimer);
        this.renderTables();
        void this.run(() => this.loadRows());
      };
      this.elements.tables.append(button);
    }
  }

  private async loadRows(): Promise<void> {
    this.cancel();
    const e = this.elements;
    e.grid.replaceChildren();
    e.prev.disabled = true;
    e.next.disabled = true;
    e.count.textContent = "";
    if (!this.selected) {
      e.title.textContent = "データベース";
      e.status.textContent = "テーブルがありません。";
      e.count.textContent = "0 テーブル";
      return;
    }
    const generation = this.generation;
    this.pending = new AbortController();
    e.title.textContent = `${this.selected.schema} / ${this.selected.name}`;
    e.status.textContent = "読み込み中…";
    const query = new URLSearchParams({
      schema: this.selected.schema, table: this.selected.name, offset: String(this.offset),
      limit: e.limit.value, search: e.search.value, sort: this.sort, direction: this.direction,
    });
    let page: DatabasePage;
    try {
      page = await this.request<DatabasePage>(this.databaseUrl(`/_admin/database/rows?${query}`), { signal: this.pending.signal });
    } catch (error) {
      if (generation !== this.generation) return;
      e.status.textContent = "";
      throw error;
    }
    if (generation !== this.generation) return;
    this.offset = page.offset;
    this.renderGrid(page);
    e.status.textContent = page.truncated ? "長い値は省略して表示しています。" : page.totalRows ? "" : "該当するレコードがありません。";
    e.count.textContent = `${page.totalRows ? page.offset + 1 : 0}–${page.offset + page.rows.length} / ${page.totalRows.toLocaleString()} レコード`;
    e.prev.disabled = page.offset === 0;
    e.next.disabled = page.offset + page.rows.length >= page.totalRows;
  }

  private renderGrid(page: DatabasePage): void {
    const table = createElement("table", "record-table");
    const head = createElement("thead");
    const headings = createElement("tr");
    headings.append(createElement("th", "row-number", "#"));
    for (const column of page.columns) {
      const cell = createElement("th");
      cell.setAttribute("scope", "col");
      cell.setAttribute("aria-sort", this.sort === column.name ? this.direction === "asc" ? "ascending" : "descending" : "none");
      const button = createElement("button", "column-sort");
      button.type = "button";
      button.append(createElement("strong", "", `${column.name}${this.sort === column.name ? this.direction === "asc" ? " ↑" : " ↓" : ""}`));
      button.append(createElement("small", "", `${column.type}${column.primaryKey ? "（主キー）" : ""}${column.nullable ? " / NULL可" : ""}`));
      button.onclick = () => {
        this.direction = this.sort === column.name && this.direction === "asc" ? "desc" : "asc";
        this.sort = column.name;
        this.offset = 0;
        void this.run(() => this.loadRows());
      };
      cell.append(button);
      headings.append(cell);
    }
    head.append(headings);
    const body = createElement("tbody");
    for (const [index, row] of page.rows.entries()) {
      const item = createElement("tr");
      item.append(createElement("td", "row-number", String(page.offset + index + 1)));
      for (const value of row) {
        const text = value === null ? "NULL" : String(value);
        const cell = createElement("td", value === null ? "null-value" : typeof value === "number" ? "number-value" : "", text);
        cell.title = text;
        item.append(cell);
      }
      body.append(item);
    }
    table.append(head, body);
    this.elements.grid.replaceChildren(table);
  }
}
