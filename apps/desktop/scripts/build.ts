import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const require = createRequire(import.meta.url);
const compiler = dirname(require.resolve("typescript/package.json"));
await mkdir(dist, { recursive: true });
await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ["src/main.ts", "src/preload.ts", "src/terminal-preload.ts", "src/window-preload.ts"],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    outdir: dist,
    outExtension: { ".js": ".cjs" },
    external: ["electron"],
    logLevel: "info",
  }),
  build({
    absWorkingDir: root,
    entryPoints: ["src/terminal.ts"],
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "iife",
    outfile: join(dist, "terminal.js"),
    logLevel: "info",
  }),
  copyFile(join(root, "src/terminal.html"), join(dist, "terminal.html")),
  copyFile(join(root, "src/terminal.css"), join(dist, "terminal.css")),
  build({ absWorkingDir: root, entryPoints: ["src/window-frame-entry.ts"], bundle: true, platform: "browser", target: "es2022", format: "iife", outfile: join(dist, "window-frame.js") }),
  copyFile(join(root, "src/window-frame.html"), join(dist, "window-frame.html")),
  copyFile(join(root, "src/window-frame.css"), join(dist, "window-frame.css")),
  copyFile(join(compiler, "LICENSE.txt"), join(dist, "typescript-LICENSE.txt")),
  copyFile(
    join(compiler, "ThirdPartyNoticeText.txt"),
    join(dist, "typescript-ThirdPartyNoticeText.txt"),
  ),
]);
