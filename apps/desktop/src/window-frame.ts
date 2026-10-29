type WindowAction = "minimize" | "maximize" | "close";
type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

interface WindowBridge {
  action(action: WindowAction): Promise<void>;
  resize(phase: "start" | "move" | "end", payload?: unknown): void;
}

declare global {
  interface Window {
    discordMockWindow?: WindowBridge;
  }
}

const initialized = new WeakSet<Document>();
const resizeEdges = new Set<string>(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);

export function initializeWindowFrame(): void {
  const bridge = window.discordMockWindow;
  if (!bridge || initialized.has(document)) return;
  initialized.add(document);

  for (const action of ["minimize", "maximize", "close"] as const) {
    document.getElementById(`window-${action}`)?.addEventListener("click", () => {
      // Closing the window can dispose the IPC handler before its reply arrives.
      void bridge.action(action).catch(() => {});
    });
  }

  let active:
    | { handle: HTMLElement; pointerId: number; screenX: number; screenY: number }
    | undefined;
  const end = () => {
    if (!active) return;
    const { handle, pointerId } = active;
    active = undefined;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    bridge.resize("end");
  };
  const move = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    if (event.screenX !== active.screenX || event.screenY !== active.screenY) {
      active.screenX = event.screenX;
      active.screenY = event.screenY;
      // Screen coordinates remain continuous while a north/west edge moves the window.
      bridge.resize("move", { screenX: event.screenX, screenY: event.screenY });
    }
  };

  for (const handle of document.querySelectorAll<HTMLElement>(".window-chrome [data-resize]")) {
    handle.addEventListener("pointerdown", (event) => {
      const edge = handle.dataset.resize;
      if (active || event.button !== 0 || !event.isPrimary || !edge || !resizeEdges.has(edge))
        return;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
      active = {
        handle,
        pointerId: event.pointerId,
        screenX: event.screenX,
        screenY: event.screenY,
      };
      bridge.resize("start", { edge: edge as ResizeEdge, screenX: event.screenX, screenY: event.screenY });
    });
  }
  window.addEventListener("pointermove", (event) => {
    if (!active || event.pointerId !== active.pointerId) return;
    move(event);
    if ((event.buttons & 1) === 0) end();
  });
  window.addEventListener("pointerup", (event) => {
    if (!active || event.pointerId !== active.pointerId) return;
    move(event);
    end();
  });
  for (const type of ["pointercancel", "lostpointercapture"] as const) {
    window.addEventListener(type, (event) => {
      if (active && event.pointerId === active.pointerId) end();
    });
  }
  window.addEventListener("blur", end);
  window.addEventListener("pagehide", end);
}
