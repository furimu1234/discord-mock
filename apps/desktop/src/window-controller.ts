import { restorePlacement, resizeBounds, type WindowStateStore } from "./window-state.ts";
import type { DisplayInfo, Rect, ResizeEdge, WindowId, WindowLayoutSettings } from "./window-types.ts";

interface NativeWindow {
  on(event: string, listener: () => void): unknown;
  getBounds(): Rect;
  getNormalBounds(): Rect;
  getMinimumSize(): number[];
  setBounds(bounds: Rect): void;
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isMinimized(): boolean;
  maximize(): void;
  unmaximize(): void;
  minimize(): void;
  restore(): void;
  show(): void;
  focus(): void;
  close(): void;
}
interface DisplayProvider {
  list(): DisplayInfo[];
  matching(bounds: Rect): DisplayInfo;
}
interface ResizeSession { bounds: Rect; edge: ResizeEdge; screenX: number; screenY: number }
const edges = new Set<string>(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
function point(value: unknown): { screenX: number; screenY: number } | undefined {
  if (!value || typeof value !== "object") return;
  const p = value as Record<string, unknown>;
  if (typeof p.screenX === "number" && typeof p.screenY === "number" &&
      Number.isFinite(p.screenX) && Number.isFinite(p.screenY) &&
      Math.abs(p.screenX) < 1_000_000 && Math.abs(p.screenY) < 1_000_000)
    return { screenX: p.screenX, screenY: p.screenY };
}

/** Electronへの依存を境界に留め、配置とIPC入力を単体で検証する。 */
export class WindowLayoutController {
  #windows = new Map<WindowId, NativeWindow>();
  #timers = new Map<WindowId, ReturnType<typeof setTimeout>>();
  #resizes = new Map<WindowId, ResizeSession>();
  #pending = new Set<Promise<void>>();
  #error: unknown;
  #maximized = new Map<WindowId, boolean>();
  #ready = new Set<WindowId>();
  #showing = new Set<Promise<void>>();
  private store: WindowStateStore;
  private displays: DisplayProvider;
  private supported: boolean;
  constructor(store: WindowStateStore, displays: DisplayProvider, supported: boolean) {
    this.store = store; this.displays = displays; this.supported = supported;
  }

  register(id: WindowId, window: NativeWindow): void {
    if (this.#windows.has(id)) throw new Error("ウィンドウは登録済みです");
    this.#windows.set(id, window);
    const placement = this.supported ? restorePlacement(id, this.displays.list(), this.store.snapshot()) : undefined;
    if (placement) window.setBounds(placement.bounds);
    let firstShow = true;
    window.on("show", () => {
      if (!firstShow) return;
      firstShow = false;
      // WSLg/X11の初回ConfigureNotifyが表示直後の座標を上書きするため、
      // 最初のWM配置を待ってから復元する（通常の移動・リサイズには遅延しない）。
      // それまでの仮座標は保存せず、最後に使った画面の履歴を守る。
      const showing = new Promise<void>(resolve => setTimeout(() => {
        if (!window.isDestroyed()) {
          if (placement) { window.setBounds(placement.bounds); if (placement.maximized) window.maximize(); }
          this.#ready.add(id);
        }
        resolve();
      }, 100));
      this.#showing.add(showing);
      void showing.finally(() => this.#showing.delete(showing));
    });
    this.#maximized.set(id, window.isMaximized());
    const schedule = () => {
      clearTimeout(this.#timers.get(id));
      this.#timers.set(id, setTimeout(() => { this.#timers.delete(id); this.#capture(id); }, 200));
    };
    for (const event of ["move", "resize", "maximize", "unmaximize"]) window.on(event, schedule);
    window.on("maximize", () => this.#maximized.set(id, true));
    window.on("unmaximize", () => { if (!window.isMinimized()) this.#maximized.set(id, false); });
    window.on("close", () => this.#capture(id));
    window.on("closed", () => {
      clearTimeout(this.#timers.get(id));
      this.#timers.delete(id);
      this.#windows.delete(id);
      this.#resizes.delete(id);
      this.#maximized.delete(id);
      this.#ready.delete(id);
    });
  }

  #capture(id: WindowId): void {
    const window = this.#windows.get(id);
    if (!this.supported || !this.#ready.has(id) || !window || window.isDestroyed()) return;
    const maximized = window.isMinimized() ? this.#maximized.get(id) ?? false : window.isMaximized();
    const normal = window.getNormalBounds();
    const display = this.displays.matching(window.isMinimized() ? normal : window.getBounds());
    const recording = this.store.record(id, display, normal, maximized);
    this.#pending.add(recording);
    void recording.then(() => { this.#error = undefined; }, error => { this.#error = error; })
      .finally(() => this.#pending.delete(recording));
  }

  settings(): WindowLayoutSettings {
    const { windows } = this.store.snapshot();
    return {
      displays: this.displays.list(), positionSupported: this.supported,
      windows: {
        mock: { startupDisplay: windows.mock.startupDisplay, lastDisplayId: windows.mock.lastDisplayId },
        terminal: { startupDisplay: windows.terminal.startupDisplay, lastDisplayId: windows.terminal.lastDisplayId },
      },
    };
  }

  async save(value: unknown): Promise<WindowLayoutSettings> {
    await this.flush();
    await this.store.setStartupDisplays(value);
    return this.settings();
  }

  async move(id: WindowId, displayId: string): Promise<void> {
    if (!this.supported) throw new Error("Waylandではウィンドウの位置を指定できません。X11で起動してください");
    const window = this.#windows.get(id);
    if (!window || window.isDestroyed()) throw new Error("ウィンドウが閉じています。アプリを再起動してください");
    const connected = this.displays.list();
    if (displayId !== "last" && displayId !== "primary" && !connected.some(display => display.id === displayId))
      throw new Error("選択したディスプレイが接続されていません");
    await this.flush();
    const data = this.store.snapshot();
    data.windows[id].startupDisplay = displayId;
    const placement = restorePlacement(id, connected, data);
    if (window.isMaximized()) window.unmaximize();
    window.setBounds(placement.bounds);
    if (placement.maximized) window.maximize();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    await this.flush();
  }

  action(id: WindowId, action: unknown): void {
    const window = this.#windows.get(id);
    if (!window || window.isDestroyed()) throw new Error("ウィンドウが閉じています");
    if (action === "minimize") window.minimize();
    else if (action === "maximize") window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === "close") window.close();
    else throw new Error("未対応のウィンドウ操作です");
  }

  resize(id: WindowId, phase: unknown, payload?: unknown): void {
    const window = this.#windows.get(id);
    if (phase === "end") { this.#resizes.delete(id); this.#capture(id); return; }
    if (!this.supported || !window || window.isDestroyed() || window.isMaximized()) { this.#resizes.delete(id); return; }
    const p = point(payload);
    if (!p) return;
    if (phase === "start") {
      this.#resizes.delete(id);
      const edge = (payload as Record<string, unknown>).edge;
      if (typeof edge === "string" && edges.has(edge))
        this.#resizes.set(id, { bounds: window.getBounds(), edge: edge as ResizeEdge, ...p });
    } else if (phase === "move") {
      const session = this.#resizes.get(id);
      if (!session) return;
      const [width = 650, height = 450] = window.getMinimumSize();
      try { window.setBounds(resizeBounds(session.bounds, session.edge, p.screenX - session.screenX, p.screenY - session.screenY, { width, height })); }
      catch { this.#resizes.delete(id); }
    }
  }

  async reconcile(): Promise<void> {
    if (!this.supported) return;
    for (const [id, window] of this.#windows) {
      if (window.isDestroyed()) continue;
      const bounds = window.getBounds();
      const display = this.displays.matching(bounds);
      const area = display.workArea;
      if (bounds.x < area.x || bounds.y < area.y || bounds.x + bounds.width > area.x + area.width || bounds.y + bounds.height > area.y + area.height) {
        const data = this.store.snapshot();
        data.windows[id].startupDisplay = display.id;
        const placement = restorePlacement(id, this.displays.list(), data);
        if (window.isMaximized()) window.unmaximize();
        window.setBounds(placement.bounds);
        if (placement.maximized) window.maximize();
      }
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    await Promise.all(this.#showing);
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    for (const id of this.#windows.keys()) this.#capture(id);
    await Promise.allSettled(this.#pending);
    await this.store.flush();
    if (this.#error) throw this.#error;
  }
}
