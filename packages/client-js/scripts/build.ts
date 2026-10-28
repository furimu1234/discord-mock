import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
await mkdir("dist", { recursive: true });
const common = {
  bundle: true,
  platform: "node" as const,
  target: "node24",
  logLevel: "info" as const,
};
await Promise.all([
  build({
    ...common,
    entryPoints: ["src/index.ts"],
    format: "esm",
    outfile: "dist/index.js",
  }),
  build({
    ...common,
    entryPoints: ["src/testing.ts"],
    format: "cjs",
    define: { "import.meta.url": "__filename", __DISMOCK_BUNDLE__: "true" },
    external: [
      "dismock/runtime",
      "dismock/e2e/runner",
      "tsx",
      "@electric-sql/pglite",
      "@electric-sql/pglite-socket",
    ],
    loader: { ".css": "text" },
    outfile: "dist/testing.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/e2e-vitest-setup.ts"],
    format: "esm",
    external: ["vitest", "dismock/e2e"],
    outfile: "dist/vitest-setup.mjs",
  }),
  build({
    ...common,
    entryPoints: ["src/case-runner.ts"],
    format: "cjs",
    outfile: "dist/runner.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/project-runtime.ts"],
    format: "cjs",
    define: { "import.meta.url": "__filename", __DISMOCK_BUNDLE__: "true" },
    external: [
      "dismock/runtime",
      "dismock/e2e/runner",
      "tsx",
      "@electric-sql/pglite",
      "@electric-sql/pglite-socket",
    ],
    loader: { ".css": "text" },
    outfile: "dist/project-runtime.cjs",
  }),
  build({
    ...common,
    entryPoints: [
      "src/project-vitest-config.ts",
      "src/project-global-setup.ts",
    ],
    format: "esm",
    external: ["vitest", "dismock/e2e", "dismock/runtime"],
    outdir: "dist",
    outExtension: { ".js": ".mjs" },
  }),
]);
const typescript = dirname(require.resolve("typescript/package.json"));
await Promise.all([
  copyFile(join(typescript, "LICENSE.txt"), "dist/typescript-LICENSE.txt"),
  copyFile(
    join(typescript, "ThirdPartyNoticeText.txt"),
    "dist/typescript-ThirdPartyNoticeText.txt",
  ),
]);
await promisify(execFile)(process.execPath, [
  join(typescript, "bin/tsc"),
  "-p",
  "tsconfig.build.json",
]);
