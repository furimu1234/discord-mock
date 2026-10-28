import type { MockSnapshot } from "./testing-types.js";
import type {
  TestRunProgress,
  TestRunPublication,
  TestRunStatus,
  TestRunTarget,
} from "./test-runs.js";

function localOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("表示先はループバック HTTP の origin を指定してください");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("表示先はループバック HTTP の origin を指定してください");
  return url.origin;
}

/** ローカル app の管理セッションへ、表示用の状態だけを順番に送る。 */
export class TestReporter {
  private id = "";
  private cookie = "";
  private csrf = "";
  private pending: Promise<void> = Promise.resolve();
  private failure: Error | undefined;
  private status: TestRunStatus = "running";
  private step = "開始";
  private readonly origin: string;

  constructor(private readonly target: TestRunTarget) {
    this.origin = localOrigin(target.baseUrl);
    if (
      typeof target.name !== "string" ||
      !target.name.trim() ||
      target.name.length > 200
    )
      throw new Error("テスト名は1〜200文字で指定してください");
  }

  private async request(
    path: string,
    method: string,
    body: unknown,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.origin), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(3000),
        headers: {
          "content-type": "application/json",
          "x-discord-mock-local": "1",
          cookie: this.cookie,
          "x-discord-mock-admin-csrf": this.csrf,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        "テストを Web に反映できません。pnpm app の起動と表示先 URL を確認してください",
      );
    }
    if (!response.ok)
      throw new Error(
        `テストの Web 反映に失敗しました (HTTP ${response.status})。pnpm build 後に app を再起動してください`,
      );
    return response;
  }

  async start(snapshot: MockSnapshot): Promise<void> {
    const response = await this.request("/_admin/session", "POST", {});
    const session = (await response.json()) as { csrf?: string };
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    if (
      !cookie ||
      !/^discord_mock_admin=[a-f0-9]{48}$/.test(cookie) ||
      !/^[a-f0-9]{48}$/.test(session.csrf ?? "")
    )
      throw new Error("表示先の app が有効な管理セッションを返しませんでした");
    this.cookie = cookie;
    this.csrf = session.csrf ?? "";
    try {
      const created = (await (
        await this.request(
          "/_admin/test-runs",
          "POST",
          this.publication(snapshot),
        )
      ).json()) as { id?: string };
      if (!created.id || !/^[a-f0-9-]{36}$/.test(created.id))
        throw new Error("表示先の app が有効な実行 ID を返しませんでした");
      this.id = created.id;
    } catch (error) {
      await this.releaseSession().catch(() => {});
      throw error;
    }
  }

  private publication(snapshot: MockSnapshot): TestRunPublication {
    return {
      name: this.target.name,
      status: this.status,
      step: this.step,
      snapshot,
    };
  }

  changed(snapshot: MockSnapshot): void {
    if (this.status !== "running") return;
    this.enqueue(snapshot);
  }

  private enqueue(snapshot: MockSnapshot): void {
    const body = this.publication(snapshot);
    this.pending = this.pending
      .then(async () => {
        if (this.failure) return;
        await this.request(`/_admin/test-runs/${this.id}`, "PUT", body);
      })
      .catch((error: unknown) => {
        this.failure =
          error instanceof Error ? error : new Error("Web 反映に失敗しました");
      });
  }

  async report(
    progress: TestRunProgress,
    snapshot: MockSnapshot,
  ): Promise<void> {
    if (this.status !== "running")
      throw new Error("完了したテストは更新できません");
    if (
      progress.status !== undefined &&
      !["running", "passed", "failed", "cancelled"].includes(progress.status)
    )
      throw new Error("テスト結果が不正です");
    if (
      progress.step !== undefined &&
      (typeof progress.step !== "string" ||
        !progress.step.trim() ||
        progress.step.length > 200)
    )
      throw new Error("実行の経過は1〜200文字で指定してください");
    this.status = progress.status ?? this.status;
    this.step = progress.step ?? this.step;
    this.enqueue(snapshot);
    await this.flush();
  }

  async close(snapshot: MockSnapshot): Promise<void> {
    try {
      if (this.status === "running")
        await this.report(
          { status: "cancelled", step: "結果未確定のまま環境を終了しました" },
          snapshot,
        );
      else await this.flush();
    } finally {
      await this.releaseSession();
    }
  }

  private async releaseSession(): Promise<void> {
    try {
      if (this.cookie) await this.request("/_admin/session", "DELETE", {});
    } finally {
      this.cookie = "";
      this.csrf = "";
    }
  }

  private async flush(): Promise<void> {
    await this.pending;
    if (this.failure) throw this.failure;
  }
}
