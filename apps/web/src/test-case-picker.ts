import { createElement } from "./dom.js";

interface TestCaseItem {
  id: string;
  name: string;
}

/** 矢印キー・マウスで選び、Enter・ダブルクリックで実行する一覧。 */
export class TestCasePicker {
  private cases: TestCaseItem[] = [];
  private selectedId = "";
  private signature = "";
  private unavailable = true;
  private readonly rows = new Map<
    string,
    { option: HTMLDivElement; marker: HTMLSpanElement }
  >();
  private readonly markers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly list: HTMLDivElement,
    private readonly onActivate: (id: string) => void,
  ) {
    list.onkeydown = (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const index = this.cases.findIndex((item) => item.id === this.selectedId);
      let next: number;
      switch (event.key) {
        case "ArrowUp":
        case "ArrowLeft":
          next = Math.max(0, index - 1);
          break;
        case "ArrowDown":
        case "ArrowRight":
          next = Math.min(this.cases.length - 1, index + 1);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = this.cases.length - 1;
          break;
        case "Enter":
          event.preventDefault();
          if (!event.repeat) this.activate();
          return;
        default:
          return;
      }
      event.preventDefault();
      const item = this.cases[next];
      if (item) {
        this.select(item.id);
        this.rows.get(item.id)?.option.scrollIntoView({ block: "nearest" });
      }
    };
  }

  get disabled(): boolean {
    return this.unavailable;
  }

  setDisabled(disabled: boolean): void {
    this.unavailable = disabled || this.cases.length === 0;
    this.list.setAttribute("aria-disabled", String(this.unavailable));
  }

  update(cases: TestCaseItem[], disabled: boolean): void {
    const signature = JSON.stringify(cases);
    if (signature !== this.signature) {
      const scrollTop = this.list.scrollTop;
      this.cases = cases;
      this.signature = signature;
      this.rows.clear();
      for (const [id, timer] of this.markers) {
        if (!cases.some((item) => item.id === id)) {
          clearTimeout(timer);
          this.markers.delete(id);
        }
      }
      const options = cases.map((item, index) => {
        const option = createElement("div", "test-case-option");
        option.setAttribute("id", `test-case-option-${index}`);
        option.setAttribute("role", "option");
        const marker = createElement(
          "span",
          "test-case-marker",
          this.markers.has(item.id) ? "●" : "",
        );
        marker.setAttribute("aria-hidden", "true");
        option.append(
          marker,
          createElement("span", "test-case-name", item.name),
        );
        option.onpointerenter = option.onpointermove = () =>
          this.select(item.id);
        option.onclick = () => {
          this.select(item.id);
          this.list.focus({ preventScroll: true });
        };
        option.ondblclick = () => {
          this.select(item.id);
          this.list.focus({ preventScroll: true });
          this.activate();
        };
        this.rows.set(item.id, { option, marker });
        return option;
      });
      this.list.replaceChildren(
        ...(options.length
          ? options
          : [
              createElement(
                "div",
                "test-case-empty",
                "テストケースがありません",
              ),
            ]),
      );
      this.selectedId = cases.some((item) => item.id === this.selectedId)
        ? this.selectedId
        : (cases[0]?.id ?? "");
      this.renderSelection();
      this.list.scrollTop = scrollTop;
    }
    this.setDisabled(disabled);
  }

  private select(id: string): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.renderSelection();
  }

  private renderSelection(): void {
    for (const [id, { option }] of this.rows) {
      option.classList.toggle("active", id === this.selectedId);
      option.setAttribute("aria-selected", String(id === this.selectedId));
    }
    const index = this.cases.findIndex((item) => item.id === this.selectedId);
    if (index >= 0)
      this.list.setAttribute(
        "aria-activedescendant",
        `test-case-option-${index}`,
      );
    else this.list.removeAttribute("aria-activedescendant");
  }

  private activate(): void {
    if (this.disabled || !this.selectedId) return;
    const id = this.selectedId;
    const row = this.rows.get(id);
    if (!row) return;
    clearTimeout(this.markers.get(id));
    row.marker.textContent = "●";
    // 実行完了や一覧の再取得とは独立して、操作した時点から3秒間表示する。
    this.markers.set(
      id,
      setTimeout(() => {
        this.markers.delete(id);
        const current = this.rows.get(id);
        if (current) current.marker.textContent = "";
      }, 3000),
    );
    this.onActivate(id);
  }
}
