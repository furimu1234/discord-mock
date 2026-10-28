import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MockRuntime, ServerOptions } from "../../server/src/server.js";
import { BotProcess } from "./bot-process.js";

let mock: MockRuntime | undefined;
let bot: BotProcess | undefined;
let testWindow: BrowserWindow | undefined;
let adminWindow: BrowserWindow | undefined;
let terminalWindow: BrowserWindow | undefined;
let quitting = false;

function serverModule(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "discord-mock-server.cjs")
    : join(__dirname, "../../server/dist/server.cjs");
}

function localWindow(title: string, width: number, height: number, preload?: string, partition?: string): BrowserWindow {
  const window = new BrowserWindow({
    title, width, height, minWidth: 650, minHeight: 450,
    backgroundColor: "#1a1b22",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      ...(preload ? { preload: join(__dirname, preload) } : {}),
      ...(partition ? { partition } : {}),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  return window;
}

function registerWindowNavigation(window: BrowserWindow, kind: "test" | "admin", url: string): void {
  window.webContents.on("will-navigate", (event, destination) => {
    const target = new URL(destination);
    if (target.origin !== url) { event.preventDefault(); return; }
    if (kind === "admin") {
      if (target.pathname !== "/admin") {
        event.preventDefault();
        testWindow?.show();
      }
    } else if (!["/", "/test", "/database", "/tests"].includes(target.pathname)) {
      event.preventDefault();
      if (target.pathname === "/admin") adminWindow?.show();
    }
  });
}

function adminHandler(name: string, action: (...args: unknown[]) => unknown): void {
  ipcMain.handle("desktop:" + name, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!mock || !adminWindow || event.sender.id !== adminWindow.webContents.id ||
      new URL(event.sender.getURL()).origin !== mock.url ||
      new URL(event.sender.getURL()).pathname !== "/admin") {
      throw new Error("管理ウィンドウ以外からの操作は禁止されています");
    }
    return action(...args);
  });
}

async function start(): Promise<void> {
  const dataDir = join(app.getPath("userData"), "local-mock");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const { startMock } = require(serverModule()) as { startMock(options: ServerOptions): Promise<MockRuntime> };
  mock = await startMock({
    port: 0,
    host: "127.0.0.1",
    statePath: join(dataDir, "state.json"),
    tokenPath: join(dataDir, "credentials.json"),
  });

  const current = mock;
  const projectCwd = process.env.PORTABLE_EXECUTABLE_DIR || process.cwd();
  bot = new BotProcess(join(dataDir, "bot-config.json"), () => ({
    DISCORD_MOCK_URL: current.url,
    DISCORD_MOCK_TOKEN: current.token,
    TOKEN: current.token,
    DISCORD_MOCK_STATE_PATH: join(dataDir, "state.json"),
  }), (entry) => {
    if (terminalWindow && !terminalWindow.isDestroyed()) terminalWindow.webContents.send("terminal:log", entry);
  }, projectCwd);
  await bot.load();

  testWindow = localWindow("Discord Mock", 1250, 820, undefined, "discord-mock-test");
  adminWindow = localWindow("Discord Mock - 管理画面", 1110, 850, "preload.cjs", "discord-mock-admin");
  terminalWindow = localWindow("Discord Mock - Bot ターミナル", 980, 580, "terminal-preload.cjs", "discord-mock-terminal");

  registerWindowNavigation(testWindow, "test", current.url);
  registerWindowNavigation(adminWindow, "admin", current.url);

  // 管理画面とテスト画面の partition を隔離し、管理セッションを HttpOnly に保持する。
  const adminSession = session.fromPartition("discord-mock-admin");
  await adminSession.cookies.set({
    url: current.url + "/_admin/ui/session",
    name: "discord_mock_admin",
    value: current.issueDesktopAdminSession(),
    httpOnly: true,
    sameSite: "strict",
    path: "/_admin/ui",
  });

  adminHandler("config", () => bot!.configuration());
  adminHandler("save-config", (value) => bot!.save(value));
  adminHandler("status", () => bot!.status());
  adminHandler("start", () => bot!.start());
  adminHandler("stop", () => bot!.stop());
  adminHandler("restart", () => bot!.restart());
  ipcMain.handle("terminal:history", (event) => {
    if (!terminalWindow || event.sender.id !== terminalWindow.webContents.id ||
      !event.sender.getURL().startsWith("file:")) throw new Error("ターミナルからのみ参照できます");
    return bot?.logs() ?? [];
  });
  await Promise.all([
    testWindow.loadURL(current.url + "/test"),
    adminWindow.loadURL(current.url + "/admin"),
    terminalWindow.loadFile(join(__dirname, "terminal.html")),
  ]);
}

app.whenReady().then(start).catch((error: unknown) => {
  console.error("Electron の起動に失敗しました:", error);
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    await bot?.stop();
    await mock?.close();
  })().catch((error) => console.error("終了処理に失敗しました:", error))
    .finally(() => app.exit());
});
