// 統合テストでは、手動ビルドした app を実行する。型は同じソースから参照する。
export const { startApp } = (await import(
  new URL("../../dist/app-runtime.mjs", import.meta.url).href
)) as typeof import("../../src/app-runtime.js");

export const { startEphemeralDatabase } = (await import(
  new URL("../../dist/database.mjs", import.meta.url).href
)) as typeof import("../../src/database.js");
