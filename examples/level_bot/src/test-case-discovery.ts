import ts from "typescript";

/** UI公開対象はソースに明示した静的なテスト名だけ。コードの評価は行わない。 */
export interface DiscoveredTestCase {
  name: string;
  /** Vitest が作る describe と test の完全な階層名 */
  fullName: string;
}

export function discoverTestCases(source: string, fileName: string): DiscoveredTestCase[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: DiscoveredTestCase[] = [];
  const known = new Set<string>();

  const titleOf = (node: ts.Node | undefined): string | undefined => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)))
      return node.text;
    return;
  };

  const groupBody = (node: ts.CallExpression): ts.Block | undefined => {
    const callback = node.arguments[1];
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        ts.isBlock(callback.body)) return callback.body;
    return;
  };

  const visit = (statement: ts.Statement, groups: readonly string[]): void => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return;
    const call = statement.expression;
    if (!ts.isIdentifier(call.expression)) return;
    const kind = call.expression.text;
    const title = titleOf(call.arguments[0]);
    if (!title) return;

    if (kind === "describe") {
      const block = groupBody(call);
      if (block) for (const child of block.statements) visit(child, [...groups, title]);
      return;
    }
    if (kind !== "test" && kind !== "it") return;
    const fullName = [...groups, title].join(" > ");
    if (known.has(fullName))
      throw new Error(`同じテスト階層に重複した名前があります: ${fileName} / ${fullName}`);
    known.add(fullName);
    found.push({
      name: [...groups, title].join(" › "),
      fullName,
    });
  };
  for (const statement of file.statements) visit(statement, []);
  return found;
}
