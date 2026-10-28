// Minimal DOM fixture for exercising the compiled script without a browser dependency.
export class Element {
  children: Element[] = [];
  textContent = "";
  value = "";
  scrollTop = 0;
  scrollHeight = 800;
  clientHeight = 300;
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
  declare oncontextmenu: (event: { preventDefault(): void; clientX?: number; clientY?: number }) => void;
  contains(target: unknown): boolean { return target === this || this.children.some((child) => child.contains(target)); }
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
    "test-log-panel": "aside",
    "test-log-entries": "div",
    "test-log-tab": "button",
    "test-users-tab": "button",
    "test-user-list": "div",
    "test-user-profile": "div",
    "test-user-menu": "div",
    "channel-sidebar": "div",
    "channel-create": "button",
    "channel-create-form": "form",
    "channel-create-name": "input",
    "channel-create-cancel": "button",
    "channel-create-submit": "button",
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
    "database-source": "select",
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
  const copied: string[] = [];
  const documentEvents = new Map<string, (event: { target?: unknown; key?: string }) => void>();
  const fireDocument = (name: string, event: { target?: unknown; key?: string }) => {
    documentEvents.get(name)?.(event);
  };
  class EventSource {
    handlers = new Map<string, () => void>();
    url: string;
    constructor(url: string) { this.url = url; streams.push(this); }
    addEventListener(name: string, handler: () => void) { this.handlers.set(name, handler); }
  }

  return {
    elements,
    streams,
    copied,
    fireDocument,
    globals: {
      location: { pathname },
      document: {
        getElementById: (id) => elements[id],
        createElement: (tag) => new Element(tag),
        addEventListener: (name: string, callback: (event: { target?: unknown; key?: string }) => void) => { documentEvents.set(name, callback); },
      },
      EventSource,
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
      navigator: { clipboard: { writeText: async (text: string) => { copied.push(text); } } },
    },
  };
}

export function textOf(element: Element): string {
  return element.textContent + element.children.map(textOf).join("");
}
