import { execFileSync } from "node:child_process";

const sourceRoots = ["apps/", "packages/client-js/", "examples/level_bot/", "scripts/"];
// 既存の ESM テスト/補助スクリプトは移行するまで保持する。新規追加は禁止。
const legacyJavaScript = new Set([
  "apps/server/tests/commands.test.mjs",
  "apps/server/tests/database.test.mjs",
  "apps/server/tests/distribution.test.mjs",
  "apps/server/tests/embeds.test.mjs",
  "apps/server/tests/interaction.test.mjs",
  "apps/server/tests/persistence.test.mjs",
  "apps/server/tests/resources.test.mjs",
  "apps/server/tests/routes.test.mjs",
  "apps/server/tests/server.test.mjs",
  "apps/server/tests/test-runs.test.mjs",
  "apps/server/tests/tokens.test.mjs",
  "apps/server/tests/ui.test.mjs",
  "apps/web/tests/browser-fixture.mjs",
  "apps/web/tests/database.test.mjs",
  "apps/web/tests/page.test.mjs",
  "apps/web/tests/test-runs.test.mjs",
  "examples/level_bot/scripts/demo.mjs",
  "packages/client-js/tests/client.test.mjs",
  "packages/client-js/tests/integration.test.mjs",
  "packages/client-js/tests/sdk-login.test.mjs",
  "packages/client-js/tests/testing-bundle.test.mjs",
]);

const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

const invalidPaths = paths.filter((path) => {
  const normalized = path.replaceAll("\\", "/");
  if (!sourceRoots.some((root) => normalized.startsWith(root))) return false;
  if (normalized.split("/").includes("dist")) return false;
  if (!/\.(?:js|jsx|mjs|cjs)$/.test(normalized)) return false;
  return !legacyJavaScript.has(normalized);
});

if (invalidPaths.length > 0) {
  console.error("新規の JavaScript ソース/テストは追加できません。TypeScript（.ts / .tsx）を使用してください。");
  for (const path of invalidPaths) console.error(`  - ${path}`);
  process.exitCode = 1;
} else {
  console.log("TypeScript ファイル拡張子の検査に成功しました。");
}
