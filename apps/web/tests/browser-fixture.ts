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
  open = false;
  attributes = new Map<string, string>();
  classes = new Set<string>();
  declare tagName: string;
  declare className: string;
  declare focused: boolean;
  declare onchange: () => void;
  declare onclick: (event?: { preventDefault(): void }) => void;
  declare ondblclick: () => void;
  declare onpointerenter: () => void;
  declare onpointermove: () => void;
  declare scrolledIntoView: boolean;
  declare oninput: () => void;
  declare onsubmit: (event: { preventDefault(): void }) => void;
  declare onkeydown: (event: { key: string; preventDefault(): void; repeat?: boolean; isComposing?: boolean }) => void;
  declare oncontextmenu: (event: { preventDefault(): void; clientX?: number; clientY?: number }) => void;
  declare id: string;
  contains(target: unknown): boolean { return target === this || this.children.some((child) => child.contains(target)); }
  classList = {
    toggle: (name: string, enabled?: boolean) => {
      const add = enabled ?? !this.classes.has(name);
      if (add) this.classes.add(name);
      else this.classes.delete(name);
      return add;
    },
    contains: (name: string) => this.classes.has(name),
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
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
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView() { this.scrolledIntoView = true; }
}

export function createBrowserFixture(pathname = "/") {
  const tags = {
    "desktop-window-settings": "section",
    "window-mock-display": "select",
    "window-terminal-display": "select",
    "window-settings-save": "button",
    "window-mock-move": "button",
    "window-terminal-move": "button",
    "window-settings-refresh": "button",
    "window-settings-status": "p",
    "window-position-note": "p",
    "test-panel": "main",
    "admin-panel": "section",
    "admin-status": "p",
    "admin-login": "form",
    "admin-secret": "input",
    "admin-content": "div",
    "admin-guild-title": "strong",
    "admin-user-count": "strong",
    "admin-channel-count": "strong",
    "admin-role-count": "strong",
    "admin-guild-name": "input",
    "admin-guild-save": "button",
    "admin-users": "div",
    "admin-user-editor": "div",
    "admin-user-create": "form",
    "admin-new-user": "input",
    "admin-new-user-id": "input",
    "admin-roles": "div",
    "admin-role-editor": "div",
    "admin-role-create": "form",
    "admin-new-role": "input",
    "admin-new-role-id": "input",
    "admin-channels": "div",
    "admin-channel-editor": "div",
    "admin-channel-create": "form",
    "admin-new-channel": "input",
    "admin-new-channel-type": "select",
    "admin-new-channel-id": "input",
    "admin-member-select": "select",
    "admin-member-roles": "div",
    "desktop-controls": "section",
    "desktop-command": "input",
    "desktop-args": "textarea",
    "desktop-cwd": "input",
    "desktop-status": "p",
    "desktop-detection-status": "p",
    "desktop-detect": "button",
    "desktop-detect-dialog": "dialog",
    "desktop-detect-directory": "p",
    "desktop-detect-cancel": "button",
    "desktop-detect-confirm": "button",
    "desktop-candidates": "select",
    "desktop-candidate-field": "label",
    "desktop-save": "button",
    "desktop-start": "button",
    "desktop-stop": "button",
    "desktop-restart": "button",
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
    "sidebar-toggle-button": "button",
    "composer-tab-chat": "button",
    "composer-tab-cases": "button",
    "manual-composer": "div",
    "test-case-composer": "div",
    "test-case-list": "div",
    "test-case-status": "span",
    "message-menu": "div",
    "message-dialog": "div",
    "message-dialog-title": "strong",
    "message-edit-form": "form",
    "message-edit-content": "textarea",
    "message-delete-preview": "p",
    "message-edit-save": "button",
    "message-edit-cancel": "button",
    "message-edit-error": "p",
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
  const documentEvents = new Map<string, Array<(event: { target?: unknown; key?: string }) => void>>();
  const windowEvents = new Map<string, () => void>();
  const fireDocument = (name: string, event: { target?: unknown; key?: string }) => {
    for (const handler of documentEvents.get(name) ?? []) handler(event);
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
    fireWindow: (name: string) => windowEvents.get(name)?.(),
    globals: {
      location: { pathname, origin: "http://127.0.0.1:3000", hash: "" },
      addEventListener: (name: string, handler: () => void) => { windowEvents.set(name, handler); },
      Node: Element,
      document: {
        getElementById: (id: string) => {
          const find = (element: Element): Element | undefined => element.id === id
            ? element : element.children.map(find).find(Boolean);
          return elements[id] ?? Object.values(elements).map(find).find(Boolean);
        },
        createElement: (tag) => new Element(tag),
        addEventListener: (name: string, callback: (event: { target?: unknown; key?: string }) => void) => {
          documentEvents.set(name, [...(documentEvents.get(name) ?? []), callback]);
        },
      },
      EventSource,
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
      clearInterval,
      navigator: { clipboard: { writeText: async (text: string) => { copied.push(text); } } },
    },
  };
}

export function textOf(element: Element): string {
  return element.textContent + element.children.map(textOf).join("");
}
