import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile, mkdir, lstat, open, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { StringDecoder } from "node:string_decoder";
import { dirname, isAbsolute, join } from "node:path";
import { AnsiDecoder, type TerminalText } from "./terminal-output.ts";
import type { LogEntry } from "./terminal-model.ts";
export type { LogEntry } from "./terminal-model.ts";
import {
  parseDesktopConnection,
  type DesktopConnection,
} from "../../../packages/client-js/src/desktop-connection.ts";

export interface BotConfig {
  command: string;
  args: string[];
  cwd: string;
  runtime?: "test-client";
}
export interface BotStatus {
  running: boolean;
  pid?: number;
  connecting?: boolean;
  url?: string;
}

export function validateConfig(value: unknown): BotConfig {
  if (!value || typeof value !== "object")
    throw new Error("Bot 起動設定が不正です");
  const config = value as Record<string, unknown>;
  if (
    typeof config.command !== "string" ||
    !config.command.trim() ||
    config.command.length > 2048 ||
    /[\r\n\0]/.test(config.command)
  )
    throw new Error("実行ファイルを指定してください");
  if (
    !Array.isArray(config.args) ||
    config.args.length > 100 ||
    config.args.some(
      (arg) => typeof arg !== "string" || arg.length > 8192 || /[\0]/.test(arg),
    )
  )
    throw new Error("引数は文字列配列にしてください");
  if (
    typeof config.cwd !== "string" ||
    !isAbsolute(config.cwd) ||
    config.cwd.length > 2048
  )
    throw new Error("作業ディレクトリには絶対パスを指定してください");
  if (
    config.runtime !== undefined &&
    (config.runtime !== "test-client" || config.command !== "node")
  )
    throw new Error("テストクライアントの起動設定が不正です");
  return {
    command: config.command,
    args: config.args as string[],
    cwd: config.cwd,
    ...(config.runtime === "test-client"
      ? { runtime: "test-client" as const }
      : {}),
  };
}

/** 端末ログと子プロセスの生命周期を管理する。任意のシェルは通さない。 */
export class BotProcess {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly entries: LogEntry[] = [];
  private config: BotConfig;
  private stopping: Promise<void> | null = null;
  private connection: DesktopConnection | undefined;
  private managed = false;
  private starting: Promise<BotStatus> | undefined;
  private logSequence = 0;

  constructor(
    private readonly configPath: string,
    private readonly environment: () => Record<string, string>,
    private readonly notify: (entry: LogEntry) => void,
    defaultCwd: string,
    private readonly connectionChanged: (
      connection: DesktopConnection | null,
    ) => void = () => {},
  ) {
    this.config = { command: "node", args: [], cwd: defaultCwd };
  }

  async load(): Promise<void> {
    try {
      this.config = validateConfig(
        JSON.parse(await readFile(this.configPath, "utf8")) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  configuration(): BotConfig {
    return { ...this.config, args: [...this.config.args] };
  }
  async save(value: unknown): Promise<BotConfig> {
    const config = validateConfig(value);
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
    await writeFile(this.configPath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    this.config = config;
    return this.configuration();
  }
  private log(
    stream: LogEntry["stream"],
    text: string,
    formatted?: TerminalText,
  ): void {
    const plain = formatted?.text ?? stripVTControlCharacters(text);
    if (!plain) return;
    const entry: LogEntry = {
      id: ++this.logSequence,
      stream,
      text: plain,
      segments: formatted?.segments ?? [{ text: plain, style: {} }],
      time: new Date().toISOString(),
    };
    this.entries.push(entry);
    if (this.entries.length > 1000) this.entries.shift();
    this.notify(entry);
  }
  logs(): LogEntry[] {
    return [...this.entries];
  }
  status(): BotStatus {
    return this.process
      ? {
          running: true,
          pid: this.process.pid,
          ...(this.managed
            ? {
                connecting: !this.connection,
                ...(this.connection ? { url: this.connection.url } : {}),
              }
            : {}),
        }
      : { running: false };
  }

  private watchConnection(
    child: ChildProcessWithoutNullStreams,
    file: string,
    nonce: string,
  ): () => void {
    let cancelled = false;
    let polling = false;
    const waitingSince = Date.now();
    let warned = false;
    const check = async () => {
      if (cancelled || polling || this.stopping) return;
      polling = true;
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.size > 4096)
          throw new Error("Invalid connection file");
        const handle = await open(
          file,
          constants.O_RDONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (constants.O_NONBLOCK ?? 0),
        );
        let value: unknown;
        try {
          const current = await handle.stat();
          if (
            process.platform !== "win32" &&
            ((current.mode & 0o077) !== 0 || current.uid !== process.getuid?.())
          )
            throw new Error("Connection file must be private to its owner");
          if (
            !current.isFile() ||
            current.ino !== info.ino ||
            current.dev !== info.dev ||
            current.size > 4096
          )
            throw new Error("Invalid connection file");
          const buffer = Buffer.alloc(4097);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead > 4096) throw new Error("Invalid connection file");
          value = JSON.parse(buffer.toString("utf8", 0, bytesRead));
        } finally {
          await handle.close();
        }
        const connection = parseDesktopConnection(value, nonce);
        const response = await fetch(`${connection.url}/_admin/ui/session`, {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: { cookie: `discord_mock_admin=${connection.adminSession}` },
        });
        const result = (await response.json()) as { authenticated?: boolean };
        if (!response.ok || result.authenticated !== true)
          throw new Error("Invalid admin session");
        if (cancelled || this.process !== child || this.stopping) return;
        this.connection = connection;
        this.connectionChanged(connection);
        this.log(
          "system",
          `テストクライアントに接続しました: ${connection.url}`,
        );
        cancel();
      } catch (error) {
        if (cancelled || this.stopping || this.process !== child) return;
        if (
          !cancelled &&
          !warned &&
          Date.now() - waitingSince > 30_000 &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          warned = true;
          this.log(
            "stderr",
            "接続情報を待っています。テストクライアント側の dismock が Electron 連携に対応しているか確認してください。",
          );
        }
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !cancelled) {
          cancel();
          this.log(
            "stderr",
            "テストクライアントの接続情報を確認できませんでした。dismock の更新と再起動を確認してください。",
          );
        }
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => {
      void check();
    }, 100);
    timer.unref();
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      clearInterval(timer);
      void Promise.all([
        rm(file, { force: true }),
        rm(`${file}.tmp`, { force: true }),
      ]).catch(() => {});
    };
    return cancel;
  }

  async start(): Promise<BotStatus> {
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async launch(): Promise<BotStatus> {
    if (this.stopping) await this.stopping;
    if (this.process) return this.status();
    const options = this.configuration();
    const env = { ...process.env, ...this.environment() };
    // pipe でも色を出す。利用者による明示的な色設定は優先する。
    if (env.FORCE_COLOR === undefined && env.NO_COLOR === undefined)
      env.FORCE_COLOR = "3";
    this.managed = options.runtime === "test-client";
    this.connection = undefined;
    let connectionFile = "";
    let nonce = "";
    if (options.runtime === "test-client") {
      // 自動取得したエントリーは独自の Mock / DB を起動する。親の接続・保存先を混ぜない。
      for (const key of [
        "TOKEN",
        "DISCORD_MOCK_TOKEN",
        "DISCORD_MOCK_URL",
        "DISCORD_MOCK_STATE_PATH",
        "DISCORD_MOCK_TOKEN_PATH",
      ])
        Reflect.deleteProperty(env, key);
      env.DISCORD_MOCK_PORT = "0";
      await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
      nonce = randomBytes(16).toString("hex");
      connectionFile = join(
        dirname(this.configPath),
        `connection-${nonce}.json`,
      );
      env.DISMOCK_DESKTOP_CONNECTION_FILE = connectionFile;
      env.DISMOCK_DESKTOP_CONNECTION_NONCE = nonce;
      if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    }
    const child = spawn(
      options.runtime === "test-client" ? process.execPath : options.command,
      options.args,
      {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.process = child;
    const cancelConnection = this.managed
      ? this.watchConnection(child, connectionFile, nonce)
      : () => {};
    child.stdin.end();
    this.log(
      "system",
      `起動: ${options.command} ${JSON.stringify(options.args)}`,
    );
    for (const stream of ["stdout", "stderr"] as const) {
      const utf8 = new StringDecoder("utf8");
      const ansi = new AnsiDecoder();
      const write = (text: string) => {
        this.log(stream, text, ansi.write(text));
      };
      child[stream].on("data", (data: Buffer) => write(utf8.write(data)));
      child[stream].on("end", () => write(utf8.end()));
    }
    child.on("error", (error) => {
      this.log("stderr", `起動エラー: ${error.message}`);
      disconnected();
    });
    const disconnected = () => {
      cancelConnection();
      if (this.process === child) {
        this.process = null;
        if (this.connection) this.connectionChanged(null);
        this.connection = undefined;
      }
    };
    child.once("exit", disconnected);
    child.on("close", (code, signal) => {
      disconnected();
      this.log("system", `Bot 終了: code=${code} signal=${signal}`);
    });
    return this.status();
  }

  async stop(): Promise<BotStatus> {
    if (this.starting) await this.starting;
    if (this.stopping) {
      await this.stopping;
      return this.status();
    }
    const child = this.process;
    if (!child) return this.status();
    if (this.connection) {
      this.connection = undefined;
      this.connectionChanged(null);
    }
    this.stopping = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
      child.kill();
      const timeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 5000);
      timeout.unref();
      child.once("exit", () => clearTimeout(timeout));
    });
    try {
      await this.stopping;
    } finally {
      this.stopping = null;
      if (this.process === child) this.process = null;
    }
    return this.status();
  }
  async restart(): Promise<BotStatus> {
    await this.stop();
    return this.start();
  }
}
