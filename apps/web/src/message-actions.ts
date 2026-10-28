import { createElement, getElement } from "./dom.js";
import { renderMessage } from "./message.js";
import {
  messageElementId,
  messageLink,
  type MessageTarget,
} from "./message-links.js";
import type { BrowserMessage } from "./types.js";

interface MessageActionOptions {
  csrf(): string;
  refresh(): Promise<void>;
  showError(message: string): void;
  beforeChange?(): Promise<void>;
}

/** メニューと編集・削除確認はチャットの再描画から独立させ、入力内容を保持する。 */
export class MessageActions {
  private readonly menu = getElement("message-menu", "div");
  private readonly dialog = getElement("message-dialog", "div");
  private readonly title = getElement("message-dialog-title", "strong");
  private readonly form = getElement("message-edit-form", "form");
  private readonly input = getElement("message-edit-content", "textarea");
  private readonly preview = getElement("message-delete-preview", "p");
  private readonly submit = getElement("message-edit-save", "button");
  private readonly cancel = getElement("message-edit-cancel", "button");
  private readonly error = getElement("message-edit-error", "p");
  private current: {
    target: MessageTarget;
    method: "PATCH" | "DELETE";
  } | null = null;
  private busy = false;

  constructor(private readonly options: MessageActionOptions) {
    document.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Node) || !this.menu.contains(event.target))
        this.closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.closeMenu();
        this.closeDialog();
      }
    });
    this.cancel.onclick = () => this.closeDialog();
    this.form.onsubmit = (event) => {
      event.preventDefault();
      void this.save();
    };
  }

  render(message: BrowserMessage, runId?: string): HTMLElement {
    const item = renderMessage(message);
    if (!message.id || !message.channel_id) return item;
    const target = {
      channelId: message.channel_id,
      messageId: message.id,
      ...(runId ? { runId } : {}),
    };
    item.id = messageElementId(target);
    item.tabIndex = -1;
    item.oncontextmenu = (event) => {
      event.preventDefault();
      this.openMenu(target, message, event.clientX, event.clientY);
    };
    return item;
  }

  close(): void {
    this.closeMenu();
    this.closeDialog();
  }
  private closeMenu(): void {
    this.menu.classList.toggle("hidden", true);
  }
  private closeDialog(): void {
    if (this.busy) return;
    this.current = null;
    this.dialog.classList.toggle("hidden", true);
  }

  private openMenu(
    target: MessageTarget,
    message: BrowserMessage,
    x = 8,
    y = 8,
  ): void {
    const buttons: HTMLButtonElement[] = [];
    const action = (label: string, handler: () => void, danger = false) => {
      const button = createElement("button", danger ? "danger" : "", label);
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.onclick = () => {
        this.closeMenu();
        handler();
      };
      buttons.push(button);
    };
    if (message.canEdit)
      action("メッセージを編集", () =>
        this.openDialog(target, message, "PATCH"),
      );
    if (message.canDelete)
      action(
        "メッセージを削除",
        () => this.openDialog(target, message, "DELETE"),
        true,
      );
    action("メッセージリンクをコピー", () => {
      void navigator.clipboard
        .writeText(messageLink(target))
        .catch(() => this.options.showError("リンクをコピーできませんでした"));
    });
    this.menu.replaceChildren(...buttons);
    this.menu.style.left = `clamp(8px, ${x}px, calc(100vw - 228px))`;
    this.menu.style.top = `clamp(8px, ${y}px, calc(100dvh - 148px))`;
    this.menu.classList.toggle("hidden", false);
    buttons[0]?.focus();
    this.menu.onkeydown = (event) => {
      const index = buttons.findIndex(
        (button) => button === document.activeElement,
      );
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        buttons[
          (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
            buttons.length
        ]?.focus();
      }
    };
  }

  private openDialog(
    target: MessageTarget,
    message: BrowserMessage,
    method: "PATCH" | "DELETE",
  ): void {
    if (this.busy) return;
    this.current = { target, method };
    const deleting = method === "DELETE";
    this.title.textContent = deleting
      ? "メッセージを削除しますか？"
      : "メッセージを編集";
    this.input.value = message.content;
    this.input.classList.toggle("hidden", deleting);
    this.input.required = !deleting && !message.embeds?.length;
    this.preview.textContent = message.content || "添付・Embedを含むメッセージ";
    this.preview.classList.toggle("hidden", !deleting);
    this.submit.textContent = deleting ? "削除" : "保存";
    this.submit.classList.toggle("danger", deleting);
    this.error.textContent = "";
    this.dialog.classList.toggle("hidden", false);
    if (deleting) this.cancel.focus();
    else this.input.focus();
    this.dialog.onkeydown = (event) => {
      if (event.key !== "Tab") return;
      const first = deleting ? this.cancel : this.input;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        this.submit.focus();
      } else if (!event.shiftKey && document.activeElement === this.submit) {
        event.preventDefault();
        first.focus();
      }
    };
  }

  private async save(): Promise<void> {
    if (!this.current || this.busy) return;
    const { target, method } = this.current;
    this.busy = true;
    this.submit.disabled = this.cancel.disabled = true;
    try {
      await this.options.beforeChange?.();
      const params = target.runId
        ? `?${new URLSearchParams({ runId: target.runId })}`
        : "";
      const response = await fetch(
        `/_ui/messages/${encodeURIComponent(target.channelId)}/${encodeURIComponent(target.messageId)}${params}`,
        {
          method,
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-discord-mock-csrf": this.options.csrf(),
          },
          ...(method === "PATCH"
            ? { body: JSON.stringify({ content: this.input.value }) }
            : {}),
        },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(
          body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
            ? body.message
            : "メッセージを変更できませんでした",
        );
      }
      this.dialog.classList.toggle("hidden", true);
      this.current = null;
      await this.options.refresh();
    } catch (error) {
      this.error.textContent =
        error instanceof Error ? error.message : "変更に失敗しました";
    } finally {
      this.busy = false;
      this.submit.disabled = this.cancel.disabled = false;
    }
  }
}
