import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  DisplayInfo,
  Rect,
  ResizeEdge,
  SavedPlacement,
  WindowId,
  WindowLayoutData,
  WindowPreference,
} from "./window-types.ts";

const maximumGeometry = 1_000_000;
const maximumFileBytes = 2 * 1024 * 1024;
const edges: readonly string[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const defaultSizes = {
  mock: { width: 1250, height: 850 },
  terminal: { width: 1060, height: 700 },
};

function initialData(): WindowLayoutData {
  return {
    version: 1,
    windows: {
      mock: { startupDisplay: "last", displays: {} },
      terminal: { startupDisplay: "last", displays: {} },
    },
  };
}

function invalid(message: string): never {
  throw new Error(`ウィンドウ配置が不正です: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("オブジェクトが必要です");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("通常のオブジェクトが必要です");
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    invalid("フィールドが不足しているか、未対応のフィールドがあります");
  }
}

function number(value: unknown, minimum = -maximumGeometry, maximum = maximumGeometry): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid("座標・サイズは範囲内の有限数にしてください");
  }
  return value;
}

function displayId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 17 && /^-?\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
}

function startupDisplay(value: unknown): string {
  if (value !== "last" && value !== "primary" && !displayId(value)) {
    invalid("起動先はlast、primary、または整数のディスプレイIDにしてください");
  }
  return value;
}

function windowId(value: unknown): asserts value is WindowId {
  if (value !== "mock" && value !== "terminal") invalid("未対応のウィンドウIDです");
}

function rect(value: unknown): Rect {
  const source = object(value);
  keys(source, ["x", "y", "width", "height"]);
  return {
    x: number(source.x), y: number(source.y),
    width: number(source.width, 1), height: number(source.height, 1),
  };
}

function placement(value: unknown): SavedPlacement {
  const source = object(value);
  keys(source, ["x", "y", "width", "height", "maximized"]);
  if (typeof source.maximized !== "boolean") invalid("最大化状態は真偽値にしてください");
  return {
    x: number(source.x), y: number(source.y),
    width: number(source.width, 1), height: number(source.height, 1),
    maximized: source.maximized,
  };
}

function preference(value: unknown): WindowPreference {
  const source = object(value);
  keys(source, ["startupDisplay", "displays"], ["lastDisplayId"]);
  const result: WindowPreference = { startupDisplay: startupDisplay(source.startupDisplay), displays: {} };
  if (Object.hasOwn(source, "lastDisplayId")) {
    if (!displayId(source.lastDisplayId)) invalid("最後のディスプレイIDが不正です");
    result.lastDisplayId = source.lastDisplayId;
  }
  const displays = object(source.displays);
  for (const id of Reflect.ownKeys(displays)) {
    if (!displayId(id)) invalid("保存先のディスプレイIDが不正です");
    result.displays[id] = placement(displays[id]);
  }
  return result;
}

function layout(value: unknown): WindowLayoutData {
  const source = object(value);
  keys(source, ["version", "windows"]);
  if (source.version !== 1) invalid("未対応のversionです");
  const windows = object(source.windows);
  keys(windows, ["mock", "terminal"]);
  return { version: 1, windows: { mock: preference(windows.mock), terminal: preference(windows.terminal) } };
}

function validateDisplay(value: DisplayInfo): void {
  if (!displayId(value.id)) invalid("ディスプレイIDが不正です");
  if (typeof value.label !== "string" || value.label.length > 1024) invalid("ディスプレイ名が不正です");
  if (typeof value.primary !== "boolean") invalid("主画面の指定が不正です");
  number(value.scaleFactor, 0.1, 16);
  rect(value.workArea);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

export function restorePlacement(
  id: WindowId,
  displays: DisplayInfo[],
  data: WindowLayoutData,
): { displayId: string; bounds: Rect; maximized: boolean } {
  windowId(id);
  if (!displays.length) invalid("利用可能な画面がありません");
  const seen = new Set<string>();
  for (const display of displays) {
    validateDisplay(display);
    if (seen.has(display.id)) invalid("ディスプレイIDが重複しています");
    seen.add(display.id);
  }
  const settings = layout(data).windows[id];
  const primary = displays.find((display) => display.primary) ?? displays[0];
  const last = displays.find((display) => display.id === settings.lastDisplayId);
  const requested = displays.find((display) => display.id === settings.startupDisplay);
  const display = settings.startupDisplay === "primary" ? primary : requested ?? last ?? primary;
  const saved = settings.displays[display.id];
  const workArea = display.workArea;
  const width = Math.min(saved?.width ?? defaultSizes[id].width, workArea.width);
  const height = Math.min(saved?.height ?? defaultSizes[id].height, workArea.height);
  // Electronの画面・ウィンドウ座標はDIPなので、拡大率を二重に適用しない。
  const x = saved ? clamp(saved.x, 0, workArea.width - width) : Math.round((workArea.width - width) / 2);
  const y = saved ? clamp(saved.y, 0, workArea.height - height) : Math.round((workArea.height - height) / 2);
  return { displayId: display.id, bounds: { x: workArea.x + x, y: workArea.y + y, width, height }, maximized: saved?.maximized ?? false };
}

export function resizeBounds(
  bounds: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  minimum: { width: number; height: number },
): Rect {
  const result = rect(bounds);
  if (!edges.includes(edge)) invalid("リサイズ方向が不正です");
  number(dx);
  number(dy);
  const minWidth = number(minimum.width, 1);
  const minHeight = number(minimum.height, 1);
  if (edge.includes("w")) {
    result.width = Math.max(minWidth, bounds.width - dx);
    result.x = bounds.x + bounds.width - result.width;
  } else if (edge.includes("e")) result.width = Math.max(minWidth, bounds.width + dx);
  if (edge.includes("n")) {
    result.height = Math.max(minHeight, bounds.height - dy);
    result.y = bounds.y + bounds.height - result.height;
  } else if (edge.includes("s")) result.height = Math.max(minHeight, bounds.height + dy);
  return rect(result);
}

async function atomicSave(file: string, value: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

export class WindowStateStore {
  #file: string;
  #data: WindowLayoutData = initialData();
  #loading: Promise<void> | undefined;
  #writes: Promise<void> = Promise.resolve();

  constructor(file: string) {
    if (typeof file !== "string" || !file || file.includes("\0")) invalid("保存先パスが不正です");
    this.#file = file;
  }

  load(): Promise<void> {
    this.#loading ??= this.#read();
    return this.#loading;
  }

  async #read(): Promise<void> {
    let contents: Buffer;
    try {
      contents = await readFile(this.#file);
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    if (contents.length > maximumFileBytes) invalid("保存ファイルが大きすぎます");
    this.#data = layout(JSON.parse(contents.toString("utf8")) as unknown);
  }

  snapshot(): WindowLayoutData {
    return structuredClone(this.#data);
  }

  async setStartupDisplays(value: unknown): Promise<void> {
    const source = object(value);
    keys(source, ["mock", "terminal"]);
    const mock = startupDisplay(source.mock);
    const terminal = startupDisplay(source.terminal);
    await this.load();
    this.#data.windows.mock.startupDisplay = mock;
    this.#data.windows.terminal.startupDisplay = terminal;
    await this.#save();
  }

  async record(id: WindowId, display: DisplayInfo, bounds: Rect, maximized: boolean): Promise<void> {
    windowId(id);
    validateDisplay(display);
    const normalBounds = rect(bounds);
    if (typeof maximized !== "boolean") invalid("最大化状態は真偽値にしてください");
    const saved = placement({
      x: normalBounds.x - display.workArea.x,
      y: normalBounds.y - display.workArea.y,
      width: normalBounds.width,
      height: normalBounds.height,
      maximized,
    });
    await this.load();
    this.#data.windows[id].lastDisplayId = display.id;
    this.#data.windows[id].displays[display.id] = saved;
    await this.#save();
  }

  #save(): Promise<void> {
    const serialized = `${JSON.stringify(this.#data, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > maximumFileBytes) invalid("保存ファイルが大きすぎます");
    // 失敗は呼び出し元へ返すが、次の明示的な保存は再試行できる。
    this.#writes = this.#writes.catch(() => {}).then(() => atomicSave(this.#file, serialized));
    return this.#writes;
  }

  async flush(): Promise<void> {
    await this.load();
    await this.#writes;
  }
}
