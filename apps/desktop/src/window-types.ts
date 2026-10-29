export type WindowId = "mock" | "terminal";

export const desktopWindowTitles = {
  admin: "Discord Mock - Admin",
  chat: "Discord Mock - Chat",
  terminal: "Discord Mock - Bot Terminal",
} as const;

export type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: string;
  label: string;
  workArea: Rect;
  scaleFactor: number;
  primary: boolean;
}

export interface SavedPlacement extends Rect {
  maximized: boolean;
}

export interface WindowPreference {
  startupDisplay: string;
  lastDisplayId?: string;
  displays: Record<string, SavedPlacement>;
}

export interface WindowLayoutData {
  version: 1;
  windows: Record<WindowId, WindowPreference>;
}

export interface WindowLayoutSettings {
  displays: DisplayInfo[];
  windows: Record<WindowId, { startupDisplay: string; lastDisplayId?: string }>;
  positionSupported: boolean;
}
