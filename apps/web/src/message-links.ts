import type { TestRunView } from "../../../packages/client-js/src/test-runs.js";

export interface MessageTarget {
  channelId: string;
  messageId: string;
  runId?: string;
}

let highlight: { id: string; timer: ReturnType<typeof setTimeout> } | undefined;

export function readMessageTarget(): MessageTarget | null {
  const params = new URLSearchParams((location.hash ?? "").slice(1));
  const channelId = params.get("channel");
  const messageId = params.get("message");
  const runId = params.get("run") ?? undefined;
  if (
    !channelId ||
    !messageId ||
    [channelId, messageId, runId ?? ""].some((part) => part.length > 100)
  )
    return null;
  return { channelId, messageId, ...(runId ? { runId } : {}) };
}

export function messageFragment(target: MessageTarget): string {
  const params = new URLSearchParams({
    channel: target.channelId,
    message: target.messageId,
  });
  if (target.runId) params.set("run", target.runId);
  return `#${params}`;
}

export function messageLink(target: MessageTarget): string {
  return `${location.origin}${target.runId ? "/test" : "/"}${messageFragment(target)}`;
}

export function messageElementId(target: MessageTarget): string {
  return `message-${target.runId ?? "app"}-${target.channelId}-${target.messageId}`;
}

export function revealMessage(target: MessageTarget, scroll: boolean): boolean {
  const id = messageElementId(target);
  const item = document.getElementById(id);
  if (!item) return false;
  if (scroll) {
    if (highlight) {
      clearTimeout(highlight.timer);
      document.getElementById(highlight.id)?.classList.remove("message-target");
    }
    highlight = {
      id,
      timer: setTimeout(() => {
        // SSEでDOMが作り直されていても、現在表示されている要素の強調を解除する。
        document.getElementById(id)?.classList.remove("message-target");
        highlight = undefined;
      }, 3000),
    };
    item.scrollIntoView({ block: "center" });
    item.focus({ preventScroll: true });
  }
  // 再描画では残り時間を引き継ぎ、期限切れの強調を復活させない。
  if (highlight?.id === id) item.classList.add("message-target");
  return true;
}

export function firstMessage(run: TestRunView): MessageTarget | null {
  const messages = Object.values(run.messages)
    .flat()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = messages[0];
  return first
    ? { runId: run.id, channelId: first.channel_id, messageId: first.id }
    : null;
}
