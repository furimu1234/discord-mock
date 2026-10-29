import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationPage } from "../src/application-navigation.ts";

const origin = "http://127.0.0.1:32100";
test("ADMINとチャットのリンクを、それぞれの認証セッションへ割り当てる", () => {
  assert.equal(applicationPage(`${origin}/admin`, origin), "admin");
  assert.equal(applicationPage(`${origin}/admin#roles`, origin), "admin");
  for (const path of [
    "/",
    "/test",
    "/database",
    "/tests",
    "/test?run=1#message",
  ]) {
    assert.equal(applicationPage(`${origin}${path}`, origin), "chat");
  }
});
test("外部URL・別ポート・資格情報・ファイル・管理APIへの画面遷移は拒否する", () => {
  for (const destination of [
    "https://example.invalid/admin",
    "http://127.0.0.1:32101/admin",
    "http://user:secret@127.0.0.1:32100/admin",
    "file:///tmp/admin",
    `${origin}/_admin/ui/state`,
    `${origin}/_mock/state`,
    `${origin}/unknown`,
    "javascript:alert(1)",
    "broken",
  ])
    assert.equal(applicationPage(destination, origin), undefined);
});
