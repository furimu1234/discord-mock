import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineE2EConfig } from "dismock/e2e";
const entry = process.env.DISMOCK_ENTRY;
if (!entry)
  throw new Error(
    "テストクライアントから --test または --test-web で実行してください",
  );
export default defineE2EConfig({
  root: process.env.DISMOCK_PROJECT_ROOT,
  setup: entry,
  globalSetup: join(
    dirname(fileURLToPath(import.meta.url)),
    "project-global-setup.mjs",
  ),
  runtimeFile: process.env.DISMOCK_RUNTIME_FILE,
  requireWeb: process.env.DISMOCK_REQUIRE_WEB === "1",
  resolve: {
    tsconfigPaths: true,
    alias: {
      "dismock/e2e": fileURLToPath(import.meta.resolve("dismock/e2e")),
      "dismock/runtime": fileURLToPath(import.meta.resolve("dismock/runtime")),
      "dismock/client": fileURLToPath(import.meta.resolve("dismock/client")),
    },
  },
});
