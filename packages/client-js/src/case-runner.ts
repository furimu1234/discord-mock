import { spawn, type ChildProcess } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { discoverTestCases } from "./case-discovery.js";
import { localOrigin } from "./e2e-runtime.js";
export { discoverTestCases } from "./case-discovery.js";
export interface TestCaseInfo {
  id: string;
  name: string;
}
export interface TestCaseRunnerOptions {
  root?: string;
  testsDir?: string;
  configFile?: string;
  env?: NodeJS.ProcessEnv;
}

interface ListedCase extends TestCaseInfo {
  file: string;
  testName: string;
}

/** Local-only allowlist: discover named cases in the repository's own TS files. */
export class LocalTestCaseRunner {
  private child: ChildProcess | undefined;
  private runningId: string | null = null;
  private error: string | null = null;
  private closed = false;
  private readonly testsDir: string;
  private readonly appDir: string;
  private readonly configFile: string;
  private readonly extraEnv: NodeJS.ProcessEnv;

  constructor(
    private readonly origin: () => string,
    options: TestCaseRunnerOptions = {},
  ) {
    this.appDir = resolve(options.root ?? process.cwd());
    this.testsDir = resolve(this.appDir, options.testsDir ?? "tests");
    this.configFile = options.configFile ?? "vitest.config.ts";
    this.extraEnv = { ...options.env };
    const path = relative(this.appDir, this.testsDir);
    if (path.startsWith(`..${sep}`) || path === ".." || isAbsolute(path))
      throw new Error("tests はプロジェクト内のディレクトリを指定してください");
  }

  private async discover(): Promise<ListedCase[]> {
    const cases: ListedCase[] = [];
    const walk = async (directory: string): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true });
      const paths: string[] = [];
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        if (entry.isDirectory())
          paths.push(...(await walk(resolve(directory, entry.name))));
        else if (entry.isFile() && entry.name.endsWith(".test.ts"))
          paths.push(resolve(directory, entry.name));
      }
      return paths;
    };
    try {
      const root = await lstat(this.testsDir);
      if (root.isSymbolicLink() || !root.isDirectory())
        throw new Error("tests は実際のディレクトリを指定してください");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    for (const file of await walk(this.testsDir)) {
      const name = relative(this.testsDir, file).split(sep).join("/");
      const source = await readFile(file, "utf8");
      const discovered = discoverTestCases(source, name);
      for (const [index, item] of discovered.entries()) {
        cases.push({
          id: `${name}:${index}`,
          name: item.name,
          file: relative(this.appDir, file).split(sep).join("/"),
          testName: item.fullName,
        });
      }
    }
    return cases;
  }

  async list(): Promise<TestCaseInfo[]> {
    return (await this.discover()).map(({ id, name }) => ({ id, name }));
  }

  status(): { runningId: string | null; error: string | null } {
    return { runningId: this.runningId, error: this.error };
  }

  async start(id: string, selectedUserId?: string): Promise<void> {
    if (this.closed) throw new Error("テストランナーは停止しています");
    if (this.runningId) throw new Error("別のテストが実行中です");
    const chosen = (await this.discover()).find((entry) => entry.id === id);
    if (!chosen) throw new Error("指定されたテストケースは存在しません");
    this.runningId = id;
    this.error = null;
    try {
      const pattern = `^${chosen.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
      const require = createRequire(resolve(this.appDir, "package.json"));
      const vitest = resolve(
        dirname(require.resolve("vitest/package.json")),
        "vitest.mjs",
      );
      const child = spawn(
        process.execPath,
        [
          vitest,
          "run",
          "--config",
          this.configFile,
          chosen.file,
          "--testNamePattern",
          pattern,
        ],
        {
          cwd: this.appDir,
          env: {
            ...process.env,
          ...this.extraEnv,
            DISCORD_MOCK_REPORT_URL: localOrigin(this.origin()),
            // テスト実行時に選択されていたユーザーをプロセスへ固定して渡す。
            DISCORD_MOCK_SELECTED_USER_ID: selectedUserId ?? "",
          },
          stdio: ["inherit", "pipe", "pipe"],
        },
      );
      this.child = child;
      // Vitestは全件skipでも終了コード0になり得る。stdoutを表示しつつ結果を検証する。
      let summary = "";
      const append = (chunk: Buffer | string, output: NodeJS.WriteStream) => {
        output.write(chunk);
        summary = (summary + String(chunk)).slice(-12_000);
      };
      child.stdout?.on("data", (chunk: Buffer) =>
        append(chunk, process.stdout),
      );
      child.stderr?.on("data", (chunk: Buffer) =>
        append(chunk, process.stderr),
      );
      child.on("close", (code) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.runningId = null;
        // 先頭にpass/failがなく「n skipped」のみなら、パターンが一致していない。
        const ansi = new RegExp(
          String.fromCharCode(27) + String.raw`\[[0-9;]*m`,
          "g",
        );
        const report = summary.replace(ansi, "");
        const allSkipped =
          /Tests\s+\d+\s+skipped\b/.test(report) &&
          !/Tests\s+.*(?:passed|failed)\b/.test(report);
        if (allSkipped) {
          this.error =
            "テスト名に一致するケースがなく全件skipされました。describe階層とテスト名を確認してください";
        } else if (code !== 0) {
          this.error =
            "テストが失敗または異常終了しました。結果とターミナル、または pnpm bot:test を確認してください";
        }
      });
      child.on("error", () => {
        this.child = undefined;
        this.runningId = null;
        this.error = "テスト実行プロセスを起動できませんでした";
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch {
      this.child = undefined;
      this.runningId = null;
      this.error =
        "テストを起動できませんでした。pnpm install と pnpm bot:test を確認してください";
      throw new Error(this.error);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    this.runningId = null;
  }
}
