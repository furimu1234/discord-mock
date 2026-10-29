import { isAbsolute } from "node:path";
import { rename, rm, writeFile } from "node:fs/promises";

export interface DesktopConnection {
  schemaVersion: 1;
  nonce: string;
  url: string;
  adminSession: string;
}
export interface DesktopConnectionRequest {
  file: string;
  nonce: string;
}

/** SDK と所有者の Electron プロセス間だけで使用する、非公開ファイルの接続通知。 */
export function desktopConnectionRequest(
  env: NodeJS.ProcessEnv = process.env,
): DesktopConnectionRequest | undefined {
  const file = env.DISMOCK_DESKTOP_CONNECTION_FILE;
  const nonce = env.DISMOCK_DESKTOP_CONNECTION_NONCE;
  if (file === undefined && nonce === undefined) return;
  if (
    !file ||
    !isAbsolute(file) ||
    file.length > 8192 ||
    /[\r\n\0]/.test(file) ||
    !nonce ||
    !/^[a-f0-9]{32}$/.test(nonce)
  )
    throw new Error("Electron 接続通知の設定が不正です");
  return { file, nonce };
}

export function parseDesktopConnection(
  value: unknown,
  nonce: string,
): DesktopConnection {
  if (!value || typeof value !== "object")
    throw new Error("Electron 接続情報が不正です");
  const data = value as Record<string, unknown>;
  if (
    data.schemaVersion !== 1 ||
    data.nonce !== nonce ||
    typeof data.url !== "string" ||
    data.url.length > 256 ||
    typeof data.adminSession !== "string" ||
    !/^[a-f0-9]{48}$/.test(data.adminSession)
  )
    throw new Error("Electron 接続情報が不正です");
  let url: URL;
  try {
    url = new URL(data.url);
  } catch {
    throw new Error("Electron 接続先が不正です");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    Number(url.port) === 0 ||
    url.username ||
    url.password ||
    data.url !== url.origin
  )
    throw new Error("Electron 接続先はローカル Mock に限定されます");
  return {
    schemaVersion: 1,
    nonce,
    url: url.origin,
    adminSession: data.adminSession,
  };
}

export async function publishDesktopConnection(
  request: DesktopConnectionRequest,
  mock: { url: string; issueDesktopAdminSession(): string },
): Promise<void> {
  const value = parseDesktopConnection(
    {
      schemaVersion: 1,
      nonce: request.nonce,
      url: mock.url,
      adminSession: mock.issueDesktopAdminSession(),
    },
    request.nonce,
  );
  const temporary = `${request.file}.tmp`;
  let created = false;
  try {
    await writeFile(temporary, JSON.stringify(value), {
      flag: "wx",
      mode: 0o600,
    });
    created = true;
    await rename(temporary, request.file);
  } catch {
    throw new Error(
      "Electron への接続通知を作成できませんでした。保存先の権限を確認してください。",
    );
  } finally {
    if (created) await rm(temporary, { force: true }).catch(() => {});
  }
}
