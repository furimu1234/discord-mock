// Minimal DOM fixture for exercising the compiled script without a browser dependency.
export class Element {
  children: Element[] = [];
  textContent = "";
  value = "";
  style: Record<string, string> = {};
  disabled = false;
  attributes = new Map<string, string>();
  classes = new Set<string>();
  declare tagName: string;
  declare className: string;
  declare focused: boolean;
  declare onchange: () => void;
  declare onclick: () => void;
  declare oninput: () => void;
  declare onsubmit: (event: { preventDefault(): void }) => void;
  declare onkeydown: (event: { key: string; preventDefault(): void; repeat?: boolean; isComposing?: boolean }) => void;
  classList = {
    toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
    add: (name: string) => { this.classes.add(name); },
  };

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get options() { return this.children; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  requestSubmit() { this.onsubmit({ preventDefault() {} }); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { this.focused = true; }
}

export function createBrowserFixture(pathname = "/") {
  const tags = {
    "test-panel": "main",
    "admin-panel": "section",
    "database-panel": "main",
    "tests-panel": "main",
    "tests-sidebar": "div",
    "tests-link": "a",
    "test-runs": "nav",
    "test-run-title": "strong",
    "test-run-status": "span",
    "test-run-steps": "ol",
    "test-run-messages": "div",
    "test-run-error": "div",
    "test-runs-refresh": "button",
    "manual-composer": "div",
    "test-case-composer": "div",
    "test-case-buttons": "div",
    "test-case-status": "span",
    "test-preview": "section",
    "test-preview-title": "strong",
    "test-preview-status": "span",
    "test-preview-steps": "ol",
    "test-preview-messages": "div",
    "test-preview-error": "p",
    "channel-sidebar": "div",
    "database-sidebar": "div",
    "user-panel": "div",
    "test-link": "a",
    "database-link": "a",
    "admin-link": "a",
    "database-title": "strong",
    "database-error": "div",
    "database-notice": "div",
    "database-notice-text": "p",
    "database-retry": "button",
    "database-content": "section",
    "database-tables": "nav",
    "database-search": "input",
    "database-refresh": "button",
    "database-grid": "div",
    "database-status": "div",
    "database-count": "span",
    "database-limit": "select",
    "database-prev": "button",
    "database-next": "button",
    error: "div",
    channels: "nav",
    identity: "select",
    "channel-title": "strong",
    "server-title": "header",
    "online-dot": "span",
    "online-label": "span",
    messages: "div",
    "message-form": "form",
    "message-input": "textarea",
    send: "button",
    "command-picker": "div",
    "command-suggestions": "div",
    "command-empty": "p",
  };
  const elements = Object.fromEntries(Object.entries(tags).map(([id, tag]) => [id, new Element(tag)])) as Record<string, Element>;
  elements["database-limit"].value = "50";
  const streams: EventSource[] = [];
  class EventSource {
    handlers = new Map<string, () => void>();
    url: string;
    constructor(url: string) { this.url = url; streams.push(this); }
    addEventListener(name: string, handler: () => void) { this.handlers.set(name, handler); }
  }

  return {
    elements,
    streams,
    globals: {
      location: { pathname },
      document: {
        getElementById: (id) => elements[id],
        createElement: (tag) => new Element(tag),
      },
      EventSource,
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
    },
  };
}

export function textOf(element: Element): string {
  return element.textContent + element.children.map(textOf).join("");
}
