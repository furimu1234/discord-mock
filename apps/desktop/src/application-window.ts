import { BaseWindow, WebContentsView } from "electron";
import { join } from "node:path";
import { desktopWindowTitles } from "./window-types.ts";
import {
  applicationPage,
  type ApplicationPage,
} from "./application-navigation.js";

/** 1つのネイティブウィンドウに、認証を共有しない管理・チャットの画面を置く。 */
export class ApplicationWindow {
  readonly window: BaseWindow;
  readonly admin: WebContentsView;
  readonly chat: WebContentsView;
  readonly chrome: WebContentsView;
  private chromeReady: Promise<void>;
  private page: ApplicationPage = "admin";

  constructor(
    private origin: string,
    preloadDirectory: string,
  ) {
    this.window = new BaseWindow({
      title: desktopWindowTitles.admin,
      width: 1250,
      height: 850,
      minWidth: 650,
      minHeight: 450,
      backgroundColor: "#17181b",
      frame: false,
      resizable: true,
      show: false,
    });
    this.chrome = new WebContentsView({ webPreferences: {
      partition: "discord-mock-chrome", preload: join(preloadDirectory, "window-preload.cjs"),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
    } });
    this.chrome.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.chrome.webContents.on("will-navigate", event => event.preventDefault());
    this.chrome.webContents.on("will-redirect", event => event.preventDefault());
    this.chrome.webContents.on("will-attach-webview", event => event.preventDefault());
    this.window.contentView.addChildView(this.chrome);
    this.chromeReady = this.chrome.webContents.loadFile(join(preloadDirectory, "window-frame.html"));
    this.chat = this.createView("discord-mock-test");
    this.admin = this.createView(
      "discord-mock-admin",
      join(preloadDirectory, "preload.cjs"),
    );
    this.window.contentView.addChildView(this.chat);
    this.window.contentView.addChildView(this.admin);
    const resize = () => {
      const [width, height] = this.window.getContentSize();
      this.chrome.setBounds({ x: 0, y: 0, width, height });
      for (const view of [this.chat, this.admin])
        view.setBounds({ x: 6, y: 34, width: Math.max(1, width - 12), height: Math.max(1, height - 40) });
    };
    // Linuxではresizeイベント内のcontent sizeが直前の値の場合がある。
    // ネイティブの更新後に読むことで、枠の当たり判定と内容を同じサイズに保つ。
    let scheduled = false;
    const scheduleResize = () => {
      if (scheduled) return;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        if (!this.window.isDestroyed()) resize();
      });
    };
    this.window.on("resize", scheduleResize);
    this.window.on("show", scheduleResize);
    this.window.on("closed", () => this.closeViews());
    resize();
    this.select("admin");
  }

  private createView(partition: string, preload?: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    const navigate = (event: Electron.Event, destination: string) => {
      const target = applicationPage(destination, this.origin);
      if (!target) {
        event.preventDefault();
        return;
      }
      const expected = target === "admin" ? this.admin : this.chat;
      if (view !== expected) {
        event.preventDefault();
        this.select(target);
        if (expected.webContents.getURL() !== destination) {
          void expected.webContents.loadURL(destination).catch(() => {
            if (!this.window.isDestroyed())
              console.error("アプリ内の画面を開けませんでした");
          });
        }
      }
    };
    view.webContents.on("will-navigate", navigate);
    view.webContents.on("will-redirect", navigate);
    return view;
  }

  private select(page: ApplicationPage): void {
    this.page = page;
    this.admin.setVisible(page === "admin");
    this.chat.setVisible(page === "chat");
    this.window.setTitle(
      page === "admin" ? desktopWindowTitles.admin : desktopWindowTitles.chat,
    );
    (page === "admin" ? this.admin : this.chat).webContents.focus();
  }

  get currentOrigin(): string {
    return this.origin;
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.chat.webContents.session.closeAllConnections(),
      this.admin.webContents.session.closeAllConnections(),
    ]);
  }

  async connect(
    origin: string,
    adminSession: string,
    page = this.page,
  ): Promise<void> {
    // 前のプロセスのCookieやユーザー表示を引き継がず、管理・テストの隔離は維持する。
    await Promise.all([
      this.chat.webContents.loadURL("about:blank"),
      this.admin.webContents.loadURL("about:blank"),
    ]);
    if (this.window.isDestroyed()) return;
    await this.disconnect();
    await Promise.all([
      this.chat.webContents.session.clearStorageData({ storages: ["cookies"] }),
      this.admin.webContents.session.clearStorageData({
        storages: ["cookies"],
      }),
    ]);
    await this.admin.webContents.session.cookies.set({
      url: `${origin}/_admin/ui/session`,
      name: "discord_mock_admin",
      value: adminSession,
      httpOnly: true,
      sameSite: "strict",
      path: "/_admin/ui",
    });
    this.origin = origin;
    await Promise.all([
      this.chat.webContents.loadURL(`${this.origin}/test`),
      this.admin.webContents.loadURL(`${this.origin}/admin`),
    ]);
    this.select(page);
  }

  async initialize(adminSession: string): Promise<void> {
    await this.chromeReady;
    await this.connect(this.origin, adminSession, "admin");
    this.show();
  }

  show(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    (this.page === "admin" ? this.admin : this.chat).webContents.focus();
  }

  closeViews(): void {
    for (const view of [this.admin, this.chat, this.chrome]) {
      if (!view.webContents.isDestroyed())
        view.webContents.close({ waitForBeforeUnload: false });
    }
  }
}
