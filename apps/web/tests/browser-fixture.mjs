// Minimal DOM fixture for exercising the compiled script without a browser dependency.
export class Element {
  children = [];
  textContent = "";
  value = "";
  style = {};
  disabled = false;
  attributes = new Map();
  classes = new Set();
  classList = {
    toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
  };

  constructor(tag) {
    this.tagName = tag.toUpperCase();
  }

  get options() { return this.children; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  requestSubmit() { this.onsubmit({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
}

export function createBrowserFixture(pathname = "/test") {
  const tags = {
    "test-panel": "main",
    "admin-panel": "section",
    "database-panel": "main",
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
  const elements = Object.fromEntries(Object.entries(tags).map(([id, tag]) => [id, new Element(tag)]));
  elements["database-limit"].value = "50";
  const streams = [];
  class EventSource {
    handlers = new Map();
    constructor(url) { this.url = url; streams.push(this); }
    addEventListener(name, handler) { this.handlers.set(name, handler); }
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
    },
  };
}

export function textOf(element) {
  return element.textContent + element.children.map(textOf).join("");
}
