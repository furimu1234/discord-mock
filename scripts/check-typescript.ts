import { execFileSync } from "node:child_process";

// Git 管理対象と未追跡のファイルを検査する。生成物だけを除外し、手書き JS に例外を設けない。
const generatedDirectories = new Set(["dist", "build", "coverage", "node_modules", ".next", ".nuxt"]);
const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const invalidPaths = paths.filter((path) => {
  const normalized = path.replaceAll("\\", "/");
  if (!/\.(?:js|jsx|mjs|cjs)$/.test(normalized)) return false;
  return !normalized.split("/").some((part) => generatedDirectories.has(part));
});

if (invalidPaths.length > 0) {
  console.error("自動生成物以外の JavaScript は禁止です。ソース・テスト・スクリプトは .ts / .tsx へ移行してください。");
  for (const path of invalidPaths) console.error(`  - ${path}`);
  process.exitCode = 1;
} else {
  console.log("手書き JavaScript は見つかりませんでした。TypeScript 拡張子検査に成功しました。");
}
