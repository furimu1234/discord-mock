import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export interface BotConfig { command: string; args: string[]; cwd: string; }
export interface BotStatus { running: boolean; pid?: number; }
export type LogEntry = { time: string; stream: "system" | "stdout" | "stderr"; text: string };

export function validateConfig(value: unknown): BotConfig {
  if (!value || typeof value !== "object") throw new Error("Bot 起動設定が不正です");
  const config = value as Record<string, unknown>;
  if (typeof config.command !== "string" || !config.command.trim() || config.command.length > 2048 || /[\r\n\0]/.test(config.command))
    throw new Error("実行ファイルを指定してください");
  if (!Array.isArray(config.args) || config.args.length > 100 ||
    config.args.some((arg) => typeof arg !== "string" || arg.length > 8192 || /[\0]/.test(arg)))
    throw new Error("引数は文字列配列にしてください");
  if (typeof config.cwd !== "string" || !isAbsolute(config.cwd) || config.cwd.length > 2048)
    throw new Error("作業ディレクトリには絶対パスを指定してください");
  return { command: config.command, args: config.args as string[], cwd: config.cwd };
}

/** 端末ログと子プロセスの生命周期を管理する。任意のシェルは通さない。 */
export class BotProcess {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly entries: LogEntry[] = [];
  private config: BotConfig;
  private stopping: Promise<void> | null = null;

  constructor(private readonly configPath: string,
    private readonly environment: () => Record<string, string>,
    private readonly notify: (entry: LogEntry) => void,
    defaultCwd: string) {
    this.config = { command: "node", args: [], cwd: defaultCwd };
  }

  async load(): Promise<void> {
    try { this.config = validateConfig(JSON.parse(await readFile(this.configPath, "utf8")) as unknown); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  configuration(): BotConfig { return { ...this.config, args: [...this.config.args] }; }
  async save(value: unknown): Promise<BotConfig> {
    const config = validateConfig(value);
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
    await writeFile(this.configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    this.config = config;
    return this.configuration();
  }
  private log(stream: LogEntry["stream"], text: string): void {
    const entry: LogEntry = { stream, text, time: new Date().toISOString() };
    this.entries.push(entry);
    if (this.entries.length > 1000) this.entries.shift();
    this.notify(entry);
  }
  logs(): LogEntry[] { return [...this.entries]; }
  status(): BotStatus { return this.process ? { running: true, pid: this.process.pid } : { running: false }; }

  async start(): Promise<BotStatus> {
    if (this.stopping) await this.stopping;
    if (this.process) return this.status();
    const options = this.configuration();
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...this.environment() },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    child.stdin.end();
    this.log("system", "起動: " + options.command + " " + JSON.stringify(options.args));
    child.stdout.on("data", (data: Buffer) => this.log("stdout", data.toString("utf8")));
    child.stderr.on("data", (data: Buffer) => this.log("stderr", data.toString("utf8")));
    child.on("error", (error) => {
      this.log("stderr", "起動エラー: " + error.message);
    });
    child.on("exit", (code, signal) => {
      if (this.process === child) this.process = null;
      this.log("system", "Bot 終了: code=" + code + " signal=" + signal);
    });
    return this.status();
  }

  async stop(): Promise<BotStatus> {
    if (this.stopping) { await this.stopping; return this.status(); }
    const child = this.process;
    if (!child) return this.status();
    this.stopping = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
      child.kill();
      const timeout = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 5000);
      timeout.unref();
      child.once("exit", () => clearTimeout(timeout));
    });
    try { await this.stopping; } finally { this.stopping = null; if (this.process === child) this.process = null; }
    return this.status();
  }
  async restart(): Promise<BotStatus> { await this.stop(); return this.start(); }
}
