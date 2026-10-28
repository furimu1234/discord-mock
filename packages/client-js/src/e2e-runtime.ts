import { readFile } from "node:fs/promises";

export function localOrigin(value: string): string {
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

export async function readE2ERuntime(
  path: string,
): Promise<{ url: string; postgresDsn?: string } | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("App の接続設定を読めません。App を再起動してください");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("url" in value) ||
    typeof value.url !== "string" ||
    ("postgresDsn" in value && typeof value.postgresDsn !== "string")
  )
    throw new Error("App の接続設定が不正です");
  const url = localOrigin(value.url);
  if (!("postgresDsn" in value)) return { url, postgresDsn: undefined };
  const postgresDsn = value.postgresDsn;
  if (typeof postgresDsn !== "string")
    throw new Error("App の接続設定が不正です");
  let database: URL;
  try {
    database = new URL(postgresDsn);
  } catch {
    throw new Error("DB の接続先はループバックに限定してください");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
    ["host", "hostaddr", "service", "servicefile"].some((key) =>
      database.searchParams.has(key),
    )
  )
    throw new Error("DB の接続先はループバックに限定してください");
  return { url, postgresDsn };
}
