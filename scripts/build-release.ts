import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const targets = ["web", "win", "mac", "linux"] as const;
type Target = (typeof targets)[number];
const root = fileURLToPath(new URL("../", import.meta.url));
const desktop = join(root, "apps/desktop");
const output = join(root, "release");
const require = createRequire(join(desktop, "package.json"));
const pnpm = process.env.npm_execpath;

function selectedTargets(args: string[]): readonly Target[] {
  if (!args.length) return targets;
  if (
    args.length === 2 &&
    args[0] === "--target" &&
    targets.some((target) => target === args[1])
  ) {
    return [args[1] as Target];
  }
  throw new Error("使用方法: pnpm build または pnpm build:web|win|mac|linux");
}

async function runNode(
  script: string,
  args: string[],
  cwd = root,
  env = process.env,
): Promise<void> {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: "inherit",
  });
  const stop = () => {
    child.kill("SIGTERM");
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, stop);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `ビルド処理が失敗しました (${signal ?? code}): ${args.join(" ")}`,
            ),
          );
      });
    });
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.removeListener(signal, stop);
  }
}

async function runPnpm(args: string[]) {
  if (!pnpm)
    throw new Error("pnpm build または pnpm build:<対象> から実行してください");
  await runNode(pnpm, args);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function prepareDesktop() {
  const manifest = await readJson(join(desktop, "package.json"));
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      manifest.version,
    )
  ) {
    throw new Error(
      "Desktop の version はパス区切りを含まない semver で指定してください",
    );
  }
  const dependencies = manifest.devDependencies as Record<string, string>;
  let installed = false;
  try {
    installed =
      (await readJson(require.resolve("electron/package.json"))).version ===
        dependencies.electron &&
      (await readJson(require.resolve("electron-builder/package.json")))
        .version === dependencies["electron-builder"];
  } catch {
    /* 初回のみ、Desktop の独立した npm 依存を準備する。 */
  }
  if (!installed) {
    console.log("Desktop のビルド依存を準備します");
    await runPnpm([
      "--dir",
      desktop,
      "exec",
      "npm",
      "install",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
    ]);
  }
  await runPnpm(["--dir", desktop, "exec", "npm", "run", "typecheck"]);
  await runPnpm(["desktop:build"]);
  const config = manifest.build as Record<string, unknown>;
  const configFile = join(output, ".build", "desktop.json");
  await mkdir(dirname(configFile), { recursive: true });
  // 一括ビルドは署名・公証・公開を行わず、既存の接続設定や秘密情報を含めない。
  await writeFile(
    configFile,
    `${JSON.stringify(
      {
        ...config,
        forceCodeSigning: false,
        publish: null,
        win: { ...(config.win as object), signExecutable: false },
        mac: { ...(config.mac as object), identity: null, notarize: false },
      },
      null,
      2,
    )}\n`,
  );
  return { configFile, version: manifest.version };
}

interface Artifact {
  target: Target;
  arch: string;
  path: string;
  bytes: number;
  sha256: string;
}
async function describeArtifact(
  target: Target,
  arch: string,
  path: string,
): Promise<Artifact> {
  const details = await stat(path);
  if (!details.isFile() || !details.size)
    throw new Error(`成果物が生成されていません: ${path}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return {
    target,
    arch,
    path: relative(output, path).replaceAll("\\", "/"),
    bytes: details.size,
    sha256: hash.digest("hex"),
  };
}

async function main() {
  const selected = selectedTargets(process.argv.slice(2));
  if (selected.includes("mac") && process.platform === "win32") {
    throw new Error(
      "Windows からの macOS クロスビルドには electron-builder が対応していません。全OS一括は WSL/Linux で pnpm build を実行してください",
    );
  }
  await mkdir(output, { recursive: true });
  const manifestFile = join(
    output,
    selected.length === targets.length
      ? "manifest.json"
      : `manifest-${selected.at(-1)}.json`,
  );
  // 前回の成功結果を、今回の途中失敗の結果として見せない。
  await rm(manifestFile, { force: true });
  if (selected.length === targets.length) await runPnpm(["build:core"]);
  else {
    await runPnpm(["--filter", "@discord-mock/web", "build"]);
    await runPnpm(["--filter", "@discord-mock/server", "build"]);
  }
  const artifacts: Artifact[] = [];
  if (selected.includes("web")) {
    const web = join(output, "web");
    await mkdir(web, { recursive: true });
    const webFile = join(web, "discord-mock.cjs");
    await copyFile(join(root, "apps/server/dist/discord-mock.cjs"), webFile);
    await writeFile(
      join(web, "README.md"),
      "# Discord Mock Web\n\nNode.js 24.17以降で `node discord-mock.cjs` を実行し、表示されたローカルURLをブラウザで開きます。npm・pnpm・node_modules は不要です。\n\n本人管理のPC/VPS専用です。既定の待受先は127.0.0.1で、SaaS・公開ホスティング用ではありません。実Discordのトークンは使用しません。\n",
    );
    artifacts.push(await describeArtifact("web", "node24", webFile));
  }
  if (selected.some((target) => target !== "web")) {
    const { configFile, version } = await prepareDesktop();
    const builderManifestPath = require.resolve(
      "electron-builder/package.json",
    );
    const builderManifest = await readJson(builderManifestPath);
    const builder = join(
      dirname(builderManifestPath),
      (builderManifest.bin as Record<string, string>)["electron-builder"],
    );
    for (const target of selected) {
      if (target === "web") continue;
      const architectures = target === "mac" ? ["x64", "arm64"] : ["x64"];
      for (const arch of architectures) {
        const name =
          target === "win"
            ? `discord-mock-${version}-windows-${arch}.exe`
            : target === "mac"
              ? `discord-mock-${version}-macos-${arch}.zip`
              : `discord-mock-${version}-linux-${arch === "x64" ? "x86_64" : arch}.AppImage`;
        const path = join(output, "desktop", name);
        await rm(path, { force: true });
        const format =
          target === "win" ? "portable" : target === "mac" ? "zip" : "AppImage";
        console.log(`ビルド: ${target} (${arch})`);
        await runNode(
          builder,
          [
            `--${target}`,
            format,
            `--${arch}`,
            "--config",
            configFile,
            "--publish",
            "never",
          ],
          desktop,
        );
        artifacts.push(await describeArtifact(target, arch, path));
      }
    }
  }
  await writeFile(
    manifestFile,
    `${JSON.stringify({ schemaVersion: 1, builtAt: new Date().toISOString(), signed: false, artifacts }, null, 2)}\n`,
  );
  console.log(`ビルド完了: ${output}`);
  for (const artifact of artifacts) console.log(`  ${artifact.path}`);
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "一括ビルドに失敗しました",
  );
  process.exitCode = 1;
}
