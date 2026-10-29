import { constants } from "node:fs";
import { open, opendir, lstat, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import ts from "typescript";
import type { BotConfig } from "./bot-process.js";

export interface DetectedClient {
  file: string;
  config: BotConfig;
}
const SOURCE_LIMIT = 512 * 1024;
const TOTAL_LIMIT = 8 * 1024 * 1024;
const ENTRY_LIMIT = 512;
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const TYPESCRIPT = /\.(?:[cm]?ts|tsx)$/i;

/** コメントや文字列中の疑似コードを除き、公開 SDK から読み込んだ関数の呼び出しを探す。 */
export function callsRunTestClient(file: string, source: string): boolean {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  const sdk = (node: ts.Node | undefined) =>
    node && ts.isStringLiteral(node) && node.text === "dismock/e2e";
  const bind = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      sdk(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements)
          if (
            !binding.isTypeOnly &&
            (binding.propertyName ?? binding.name).text === "runTestClient"
          )
            functions.add(binding.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const value = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (
        ts.isCallExpression(value) &&
        sdk(value.arguments[0]) &&
        ((ts.isIdentifier(value.expression) &&
          value.expression.text === "require") ||
          value.expression.kind === ts.SyntaxKind.ImportKeyword)
      ) {
        if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const binding of node.name.elements)
            if (
              ts.isIdentifier(binding.name) &&
              (binding.propertyName ?? binding.name).getText(tree) ===
                "runTestClient"
            )
              functions.add(binding.name.text);
        }
      }
    }
    ts.forEachChild(node, bind);
  };
  bind(tree);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && functions.has(expression.text))
        found = true;
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        namespaces.has(expression.expression.text) &&
        expression.name.text === "runTestClient"
      )
        found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

async function readSource(path: string): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    // シンボリックリンク・FIFO を読み込まず、読み取り中の増大にも上限を設ける。
    const original = await lstat(path);
    if (!original.isFile()) return;
    handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.ino !== original.ino ||
      info.dev !== original.dev
    )
      return;
    if (info.size > SOURCE_LIMIT)
      throw new Error("起動ファイルの自動取得は1ファイル512 KiBまでです");
    const data = Buffer.alloc(SOURCE_LIMIT + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await handle.read(
        data,
        length,
        data.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > SOURCE_LIMIT)
      throw new Error("起動ファイルの自動取得は1ファイル512 KiBまでです");
    return data.toString("utf8", 0, length);
  } catch (error) {
    if (
      ["ENOENT", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      return;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function nearestTsconfig(directory: string): Promise<string | undefined> {
  for (let current = directory; ; current = dirname(current)) {
    const path = join(current, "tsconfig.json");
    if (
      await lstat(path).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return path;
    if (dirname(current) === current) return;
  }
}

function tsxCommand(entry: string): string {
  const local = createRequire(entry);
  try {
    return local.resolve("tsx/cli");
  } catch {
    /* SDK の optional dependency も確認する。 */
  }
  try {
    return createRequire(local.resolve("dismock/e2e")).resolve("tsx/cli");
  } catch {
    throw new Error(
      "TypeScript の起動に必要な tsx が見つかりません。プロジェクトに tsx をインストールしてください",
    );
  }
}

/** アプリと同じフォルダー直下だけを読み取り、実行せずに候補と起動設定を返す。 */
export async function discoverTestClients(
  directory: string,
): Promise<DetectedClient[]> {
  const matches: string[] = [];
  let count = 0;
  let bytes = 0;
  for await (const entry of await opendir(directory)) {
    if (++count > ENTRY_LIMIT)
      throw new Error("自動取得の対象フォルダーは512項目までです");
    if (
      !entry.isFile() ||
      !SOURCE.test(entry.name) ||
      /\.d\.[cm]?ts$/i.test(entry.name)
    )
      continue;
    const source = await readSource(join(directory, entry.name));
    if (source === undefined) continue;
    bytes += Buffer.byteLength(source);
    if (bytes > TOTAL_LIMIT)
      throw new Error("自動取得で読み取れるソースは合計8 MiBまでです");
    if (callsRunTestClient(entry.name, source)) matches.push(entry.name);
  }
  const result: DetectedClient[] = [];
  for (const file of matches.sort()) {
    const entry = join(directory, file);
    const args: string[] = [];
    if (TYPESCRIPT.test(file) || /\.jsx$/i.test(file)) {
      args.push(tsxCommand(entry));
      const tsconfig = await nearestTsconfig(directory);
      if (tsconfig) args.push("--tsconfig", tsconfig);
    }
    args.push(entry);
    result.push({
      file,
      config: { command: "node", args, cwd: directory, runtime: "test-client" },
    });
  }
  return result;
}
