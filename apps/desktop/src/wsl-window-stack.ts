import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { windowStackHostScript } from "./wsl-window-stack-host.ts";

interface Request {
  id: number;
  activeTitles: string[];
  peerTitles: string[];
  resolve(): void;
  reject(error: Error): void;
}
interface Reply { id: number; resolve(): void; reject(error: Error): void }
function validText(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}

/** 常駐ホストへJSONのみを渡す。選択が変わった要求は送信前にまとめる。 */
export class HostWindowStack {
  #host: ChildProcessWithoutNullStreams;
  #distro: string;
  #titleGroups: readonly (readonly string[])[];
  #reader: Interface;
  #ready: Promise<void>;
  #resolveReady: () => void = () => {};
  #rejectReady: (error: Error) => void = () => {};
  #exit: Promise<void>;
  #readyTimer: ReturnType<typeof setTimeout>;
  #replyTimer: ReturnType<typeof setTimeout> | undefined;
  #queued: Request | undefined;
  #reply: Reply | undefined;
  #sequence = 0;
  #pumping = false;
  #closed = false;
  #failure: Error | undefined;

  constructor(host: ChildProcessWithoutNullStreams, distro: string, titleGroups: readonly (readonly string[])[] = []) {
    this.#host = host;
    this.#distro = distro;
    this.#titleGroups = titleGroups.map(group => [...group]);
    this.#ready = new Promise<void>((resolve, reject) => { this.#resolveReady = resolve; this.#rejectReady = reject; });
    void this.#ready.catch(() => {});
    this.#readyTimer = setTimeout(() => this.#fail(new Error("WSLgウィンドウ連動ホストの起動がタイムアウトしました")), 10_000);
    this.#readyTimer.unref();
    this.#reader = createInterface({ input: host.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    this.#reader.on("line", line => this.#receive(line));
    host.stderr.resume();
    host.on("error", () => this.#fail(new Error("WSLgウィンドウ連動ホストを起動できません")));
    host.stdin.on("error", () => this.#fail(new Error("WSLgウィンドウ連動ホストへの通信が切断されました")));
    this.#exit = new Promise(resolve => host.once("close", code => {
      if (!this.#closed) this.#fail(new Error(`WSLgウィンドウ連動ホストが終了しました (${code})`));
      resolve();
    }));
  }

  raise(activeTitle: string, peerTitle: string): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (!validText(activeTitle) || !validText(peerTitle) || !validText(this.#distro) || activeTitle === peerTitle)
      return Promise.reject(new Error("ウィンドウのタイトルが不正です"));
    const activeTitles = [...(this.#titleGroups.find(group => group.includes(activeTitle)) ?? [activeTitle])];
    const peerTitles = [...(this.#titleGroups.find(group => group.includes(peerTitle)) ?? [peerTitle])];
    if ([activeTitles, peerTitles].some(group => group.length > 8 || group.some(title => !validText(title))))
      return Promise.reject(new Error("ウィンドウのタイトルが不正です"));
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise<void>((resolve, reject) => {
      this.#queued?.resolve();
      this.#queued = { id: ++this.#sequence, activeTitles, peerTitles, resolve, reject };
      void this.#pump();
    });
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      await this.#ready;
      while (this.#queued && !this.#closed && !this.#failure) {
        const request = this.#queued;
        this.#queued = undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            this.#reply = { id: request.id, resolve, reject };
            this.#replyTimer = setTimeout(() => this.#fail(new Error("WSLgウィンドウ連動の応答がタイムアウトしました")), 5000);
            this.#replyTimer.unref();
            this.#host.stdin.write(`${JSON.stringify({ id: request.id, activeTitles: request.activeTitles, peerTitles: request.peerTitles, distro: this.#distro })}\n`);
          });
          request.resolve();
        } catch (error) { request.reject(error instanceof Error ? error : new Error(String(error))); }
      }
    } catch (error) { this.#fail(error instanceof Error ? error : new Error(String(error))); }
    finally { this.#pumping = false; }
  }

  #receive(line: string): void {
    if (this.#closed || this.#failure) return;
    try {
      if (line.length > 16_384) throw new Error("oversized response");
      const value: unknown = JSON.parse(line.replace(/^\uFEFF/, ""));
      if (!value || typeof value !== "object") throw new Error("invalid response");
      const response = value as Record<string, unknown>;
      if (response.ready === true && !this.#reply) {
        clearTimeout(this.#readyTimer); this.#resolveReady(); return;
      }
      const reply = this.#reply;
      if (!reply || response.id !== reply.id || !["placed", "skipped", "error"].includes(String(response.status))) throw new Error("unexpected response");
      clearTimeout(this.#replyTimer);
      this.#reply = undefined;
      if (response.status === "error") reply.reject(new Error("Windowsでウィンドウの重なり順を変更できません"));
      else reply.resolve();
    } catch { this.#fail(new Error("WSLgウィンドウ連動ホストの応答が不正です")); }
  }

  #fail(error: Error): void {
    if (this.#closed || this.#failure) return;
    this.#failure = error;
    clearTimeout(this.#readyTimer); clearTimeout(this.#replyTimer);
    this.#rejectReady(error);
    this.#reply?.reject(error); this.#reply = undefined;
    this.#queued?.reject(error); this.#queued = undefined;
    if (!this.#host.stdin.destroyed) this.#host.stdin.end();
  }

  async close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      clearTimeout(this.#readyTimer); clearTimeout(this.#replyTimer);
      this.#resolveReady();
      this.#reply?.resolve(); this.#reply = undefined;
      this.#queued?.resolve(); this.#queued = undefined;
      this.#reader.close();
      if (!this.#host.stdin.destroyed) this.#host.stdin.end();
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.#host.kill(); resolve(); }, 1000);
      void this.#exit.then(() => { clearTimeout(timer); resolve(); });
    });
  }
}

export function createWslWindowStack(distro: string, titleGroups: readonly (readonly string[])[] = []): HostWindowStack {
  const encoded = Buffer.from(windowStackHostScript, "utf16le").toString("base64");
  const host = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  return new HostWindowStack(host, distro, titleGroups);
}
