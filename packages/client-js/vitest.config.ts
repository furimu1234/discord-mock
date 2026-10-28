import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // テストは手動ビルドした配布物を検証し、型チェックはソースを参照する。
  resolve: {
    alias: {
      "@discord-mock/client-js/testing": fileURLToPath(
        new URL("./dist/testing.cjs", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/types.test.ts", "tests/**/*.node.test.ts"],
    environment: "node",
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
