import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverTestCases } from "./test-case-discovery.js";
import { fileURLToPath } from "node:url";
import type { TestCaseInfo, TestCaseService } from "../../../apps/server/src/test-cases.js";

interface ListedCase extends TestCaseInfo {
  file: string;
  testName: string;
}

/** Local-only allowlist: discover named cases in the repository's own TS files. */
export class LocalTestCaseRunner implements TestCaseService {
  private child: ChildProcess | undefined;
  private runningId: string | null = null;
  private error: string | null = null;
  private closed = false;
  private readonly testsDir = fileURLToPath(new URL("../tests/bot/", import.meta.url));
  private readonly appDir = fileURLToPath(new URL("../", import.meta.url));
  private readonly vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

  constructor(private readonly origin: () => string) {}

  private async discover(): Promise<ListedCase[]> {
    const files = await readdir(this.testsDir, { withFileTypes: true });
    const cases: ListedCase[] = [];
    for (const file of files.filter((f) => f.isFile() && /^[a-zA-Z0-9_-]+\.test\.ts$/.test(f.name)).sort((a,b) => a.name.localeCompare(b.name))) {
      const source = await readFile(resolve(this.testsDir, file.name), "utf8");
      const discovered = discoverTestCases(source, file.name);
      for (const [index, item] of discovered.entries()) {
        cases.push({
          id: `${file.name}:${index}`,
          name: item.name,
          file: `tests/bot/${file.name}`,
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
      const child = spawn(process.execPath, [
        this.vitest, "run", "--config", "vitest.web.config.ts", chosen.file,
        "--testNamePattern", pattern,
      ], {
        cwd: this.appDir,
        env: {
          ...process.env,
          DISCORD_MOCK_REPORT_URL: this.origin(),
          // テスト実行時に選択されていたユーザーをプロセスへ固定して渡す。
          DISCORD_MOCK_SELECTED_USER_ID: selectedUserId ?? "",
        },
        stdio: ["inherit", "pipe", "pipe"],
      });
      this.child = child;
      // Vitestは全件skipでも終了コード0になり得る。stdoutを表示しつつ結果を検証する。
      let summary = "";
      const append = (chunk: Buffer | string, output: NodeJS.WriteStream) => {
        output.write(chunk);
        summary = (summary + String(chunk)).slice(-12_000);
      };
      child.stdout?.on("data", (chunk: Buffer) => append(chunk, process.stdout));
      child.stderr?.on("data", (chunk: Buffer) => append(chunk, process.stderr));
      child.on("close", (code) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.runningId = null;
        // 先頭にpass/failがなく「n skipped」のみなら、パターンが一致していない。
        const ansi = new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, "g");
        const report = summary.replace(ansi, "");
        const allSkipped = /Tests\s+\d+\s+skipped\b/.test(report) &&
          !/Tests\s+.*(?:passed|failed)\b/.test(report);
        if (allSkipped) {
          this.error = "テスト名に一致するケースがなく全件skipされました。describe階層とテスト名を確認してください";
        } else if (code !== 0) {
          this.error = "テストが失敗または異常終了しました。結果とターミナル、または pnpm bot:test を確認してください";
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
      this.error = "テストを起動できませんでした。pnpm install と pnpm bot:test を確認してください";
      throw new Error(this.error);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    this.runningId = null;
  }
}
