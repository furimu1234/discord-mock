import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopConnectionRequest,
  parseDesktopConnection,
  publishDesktopConnection,
} from "../src/desktop-connection.js";

const nonce = "a".repeat(32);
const cookie = "b".repeat(48);
const value = {
  schemaVersion: 1,
  nonce,
  url: "http://127.0.0.1:32123",
  adminSession: cookie,
};
describe("Electron の非公開接続通知", () => {
  it("明示的な起動要求だけを受理し、不正なパス・nonce・接続先を拒否する", () => {
    expect(desktopConnectionRequest({})).toBeUndefined();
    for (const env of [
      {
        DISMOCK_DESKTOP_CONNECTION_FILE: "relative.json",
        DISMOCK_DESKTOP_CONNECTION_NONCE: nonce,
      },
      { DISMOCK_DESKTOP_CONNECTION_FILE: join(tmpdir(), "notify.json") },
      { DISMOCK_DESKTOP_CONNECTION_NONCE: nonce },
    ])
      expect(() => desktopConnectionRequest(env)).toThrow();
    expect(parseDesktopConnection(value, nonce)).toEqual(value);
    for (const url of [
      "https://example.invalid",
      "http://localhost:32123",
      "http://127.0.0.1:0",
      "http://127.0.0.1:32123/path",
      "http://secret@127.0.0.1:32123",
      "http://127.0.0.1:32123?token=secret",
    ]) {
      expect(() => parseDesktopConnection({ ...value, url }, nonce)).toThrow();
    }
    expect(() => parseDesktopConnection(value, "c".repeat(32))).toThrow();
    expect(() =>
      parseDesktopConnection({ ...value, adminSession: "invalid" }, nonce),
    ).toThrow();
  });
  it("管理者Cookieは所有者専用ファイルに原子的に公開し、既存の一時ファイルを消さない", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dismock-desktop-notify-"));
    const file = join(directory, "notify.json");
    try {
      const request = desktopConnectionRequest({
        DISMOCK_DESKTOP_CONNECTION_FILE: file,
        DISMOCK_DESKTOP_CONNECTION_NONCE: nonce,
      });
      expect(request).toBeDefined();
      if (!request) throw new Error("Missing request");
      await publishDesktopConnection(request, {
        url: value.url,
        issueDesktopAdminSession: () => cookie,
      });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(value);
      if (process.platform !== "win32")
        expect((await stat(file)).mode & 0o077).toBe(0);
      await writeFile(`${file}.tmp`, "keep");
      await expect(
        publishDesktopConnection(request, {
          url: value.url,
          issueDesktopAdminSession: () => cookie,
        }),
      ).rejects.toThrow();
      expect(await readFile(`${file}.tmp`, "utf8")).toBe("keep");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
