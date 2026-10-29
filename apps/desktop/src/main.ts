import { app, BaseWindow, BrowserWindow, clipboard, ipcMain, screen, type IpcMainInvokeEvent, type IpcMainEvent } from "electron";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MockRuntime, ServerOptions } from "../../server/src/server.js";
import { BotProcess } from "./bot-process.js";
import { ApplicationWindow } from "./application-window.js";
import { applicationPage } from "./application-navigation.js";
import { discoverTestClients } from "./client-discovery.js";
import { WindowStateStore } from "./window-state.ts";
import { WindowLayoutController } from "./window-controller.ts";
import { desktopWindowTitles, type DisplayInfo, type WindowId } from "./window-types.ts";
import { linkWindowActivation } from "./window-activation.ts";
import { createWslWindowStack, type HostWindowStack } from "./wsl-window-stack.ts";

// Waylandはグローバル座標を提供しない。利用可能なX11を既定にし、明示指定を尊重する。
if (process.platform === "linux" && process.env.DISPLAY && !app.commandLine.hasSwitch("ozone-platform"))
  app.commandLine.appendSwitch("ozone-platform", "x11");
const ozonePlatform = app.commandLine.getSwitchValue("ozone-platform");
const positionSupported = process.platform !== "linux" || ozonePlatform === "x11" || (!ozonePlatform && !process.env.WAYLAND_DISPLAY);

let mock: MockRuntime | undefined;
let bot: BotProcess | undefined;
let applicationWindow: ApplicationWindow | undefined;
let terminalWindow: BrowserWindow | undefined;
let quitting = false;
let windowLayout: WindowLayoutController | undefined;
let stopWindowActivation: (() => void) | undefined;
let windowStackHost: HostWindowStack | undefined;

function serverModule(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "discord-mock-server.cjs")
    : join(__dirname, "../../server/dist/server.cjs");
}

function localWindow(title: string, width: number, height: number, preload?: string, partition?: string): BrowserWindow {
  const window = new BrowserWindow({
    title, width, height, minWidth: 650, minHeight: 450, autoHideMenuBar: true,
    backgroundColor: "#17181b", frame: false, resizable: true, show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      ...(preload ? { preload: join(__dirname, preload) } : {}),
      ...(partition ? { partition } : {}),
    },
  });
  // Web 版の共通タイトルで、管理画面とテスト画面の区別が消えないようにする。
  window.on("page-title-updated", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  return window;
}

/** 配布物を testclient と同階層に配置した場合は、その階層を初期作業フォルダーにする。 */
function clientDirectory(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.APPIMAGE) return dirname(process.env.APPIMAGE);
  if (app.isPackaged && process.platform === "darwin") return resolve(dirname(process.execPath), "../../..");
  return process.cwd();
}

function adminHandler(name: string, action: (...args: unknown[]) => unknown): void {
  ipcMain.handle(`desktop:${name}`, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!mock || !applicationWindow || event.sender.id !== applicationWindow.admin.webContents.id ||
      event.senderFrame !== event.sender.mainFrame || applicationPage(event.sender.getURL(), applicationWindow.currentOrigin) !== "admin") {
      throw new Error("管理画面以外からの操作は禁止されています");
    }
    return action(...args);
  });
}

async function start(): Promise<void> {
  const dataDir = join(app.getPath("userData"), "local-mock");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = new WindowStateStore(join(dataDir, "window-layout.json"));
  await store.load();
  const displayInfo = (display: Electron.Display): DisplayInfo => ({
    id: String(display.id), label: display.label || `ディスプレイ ${display.id}`,
    workArea: { ...display.workArea }, scaleFactor: display.scaleFactor,
    primary: display.id === screen.getPrimaryDisplay().id,
  });
  const layout = new WindowLayoutController(store, {
    list: () => screen.getAllDisplays().map(displayInfo),
    matching: bounds => displayInfo(screen.getDisplayMatching(bounds)),
  }, positionSupported);
  windowLayout = layout;
  const reconcile = () => { void layout.reconcile().catch(error => console.error("ウィンドウ配置を更新できません:", error)); };
  screen.on("display-removed", reconcile);
  screen.on("display-metrics-changed", reconcile);
  const { startMock } = require(serverModule()) as { startMock(options: ServerOptions): Promise<MockRuntime> };
  mock = await startMock({
    port: 0,
    host: "127.0.0.1",
    statePath: join(dataDir, "state.json"),
    tokenPath: join(dataDir, "credentials.json"),
  });

  const current = mock;
  const fallbackSession = current.issueDesktopAdminSession();
  let connectionRevision = 0;
  let transition: Promise<void> = Promise.resolve();
  const projectCwd = clientDirectory();
  bot = new BotProcess(join(dataDir, "bot-config.json"), () => ({
    DISCORD_MOCK_URL: current.url,
    DISCORD_MOCK_TOKEN: current.token,
    TOKEN: current.token,
    DISCORD_MOCK_STATE_PATH: join(dataDir, "state.json"),
  }), (entry) => {
    if (terminalWindow && !terminalWindow.isDestroyed()) terminalWindow.webContents.send("terminal:log", entry);
  }, projectCwd, (connection) => {
    const revision = ++connectionRevision;
    transition = transition.catch(() => {}).then(async () => {
      if (quitting || revision !== connectionRevision || !applicationWindow) return;
      await applicationWindow.connect(connection?.url ?? current.url, connection?.adminSession ?? fallbackSession, connection ? undefined : "admin");
    }).catch(() => { if (!quitting && revision === connectionRevision) console.error("テストクライアントの画面への切り替えに失敗しました"); });
  });
  await bot.load();

  applicationWindow = new ApplicationWindow(current.url, __dirname);
  applicationWindow.window.on("close", event => {
    if (!quitting) { event.preventDefault(); app.quit(); }
  });
  terminalWindow = localWindow(desktopWindowTitles.terminal, 1060, 700, "terminal-preload.cjs", "discord-mock-terminal");
  layout.register("mock", applicationWindow.window);
  layout.register("terminal", terminalWindow);
  if (process.platform === "linux" && process.env.WSL_DISTRO_NAME && process.env.WSL_INTEROP)
    windowStackHost = createWslWindowStack(process.env.WSL_DISTRO_NAME, [
      [desktopWindowTitles.admin, desktopWindowTitles.chat], [desktopWindowTitles.terminal],
    ]);

  // 自身のローカルUI以外（管理・チャット・サブフレーム）からは操作できない。
  const windowSender = (event: IpcMainInvokeEvent | IpcMainEvent): WindowId | undefined => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    if (event.sender === applicationWindow?.chrome.webContents && event.sender.getURL() === pathToFileURL(join(__dirname, "window-frame.html")).href) return "mock";
    if (event.sender === terminalWindow?.webContents && event.sender.getURL() === pathToFileURL(join(__dirname, "terminal.html")).href) return "terminal";
  };
  ipcMain.handle("window:action", (event, action: unknown) => {
    const id = windowSender(event);
    if (!id) throw new Error("ウィンドウ自身の操作UIからのみ操作できます");
    layout.action(id, action);
  });
  ipcMain.on("window:resize", (event, phase: unknown, payload: unknown) => {
    const id = windowSender(event);
    if (id) layout.resize(id, phase, payload);
  });

  const currentBot = bot;
  adminHandler("config", () => currentBot.configuration());
  adminHandler("discovery-directory", () => projectCwd);
  adminHandler("discover", () => discoverTestClients(projectCwd));
  adminHandler("save-config", (value) => currentBot.save(value));
  adminHandler("status", () => currentBot.status());
  adminHandler("start", () => currentBot.start());
  adminHandler("stop", () => currentBot.stop());
  adminHandler("restart", () => currentBot.restart());
  adminHandler("window-settings", () => layout.settings());
  adminHandler("save-window-settings", value => layout.save(value));
  adminHandler("move-window", (id, display) => {
    if ((id !== "mock" && id !== "terminal") || typeof display !== "string") throw new Error("ウィンドウまたは起動先が不正です");
    return layout.move(id, display);
  });
  const terminalHandler = (name: string, action: (...args: unknown[]) => unknown) => {
    ipcMain.handle(`terminal:${name}`, (event, ...args: unknown[]) => {
      if (!terminalWindow || event.sender.id !== terminalWindow.webContents.id ||
        event.senderFrame !== event.sender.mainFrame ||
        event.sender.getURL() !== pathToFileURL(join(__dirname, "terminal.html")).href)
        throw new Error("ターミナルからのみ操作できます");
      return action(...args);
    });
  };
  terminalHandler("history", () => currentBot.logs());
  terminalHandler("status", () => currentBot.status());
  terminalHandler("copy", (text) => {
    if (typeof text !== "string" || text.length > 1_048_576) throw new Error("コピーするログを絞り込んでください");
    clipboard.writeText(text);
  });
  await Promise.all([
    applicationWindow.initialize(fallbackSession),
    terminalWindow.loadFile(join(__dirname, "terminal.html")),
  ]);
  const stackHost = windowStackHost;
  let stackErrorShown = false;
  stopWindowActivation = linkWindowActivation(applicationWindow.window, terminalWindow, stackHost ? (active, peer) => {
    void stackHost.raise(active.getTitle(), peer.getTitle()).catch(error => {
      if (!quitting && !stackErrorShown) {
        stackErrorShown = true;
        console.error("WSLgでウィンドウの重なり順を更新できません:", error);
      }
    });
  } : undefined);
  applicationWindow.show();
  terminalWindow.show();
}

if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => {
    for (const window of BaseWindow.getAllWindows()) {
      if (window.isMinimized()) window.restore();
      window.show();
    }
    applicationWindow?.show();
  });
  app.whenReady().then(start).catch((error: unknown) => {
    console.error("Electron の起動に失敗しました:", error);
    app.exit(1);
  });
} else app.exit(0);

app.on("window-all-closed", () => { if (!quitting) app.quit(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => app.quit());
app.on("before-quit", (event) => {
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  stopWindowActivation?.();
  stopWindowActivation = undefined;
  void (async () => {
    await windowStackHost?.close();
    await windowLayout?.flush().catch(error => console.error("ウィンドウ配置を保存できません:", error));
    // 画面の SSE / HTTP 接続と再接続を止めてから、サーバーの終了と JSON 保存を待つ。
    const disconnecting = applicationWindow?.disconnect();
    applicationWindow?.closeViews();
    for (const window of BaseWindow.getAllWindows()) window.destroy();
    await disconnecting?.catch(() => {});
    await bot?.stop();
    const closing = mock?.close();
    // Chromium の未使用の先行接続も閉じ、JSON の保存完了まで待機する。
    mock?.server.closeAllConnections();
    await closing;
  })().catch((error) => console.error("終了処理に失敗しました:", error))
    .finally(() => app.exit());
});
