# GitHub Copilot 向け開発指示

## TypeScript を標準とする
- 作業前にルートの `AGENTS.md` と対象ディレクトリの `AGENTS.md` を読み、両方の指示を守る。
- `apps/web/`、`apps/server/`、`packages/client-js/`、`examples/level_bot/`、`scripts/` の新しい JS 系ソース、テスト、スクリプトは必ず `.ts`（JSX が必要なら `.tsx`）で作成する。型宣言のみ `.d.ts` を使用する。
- **既存の手書き `.js` / `.jsx` / `.mjs` / `.cjs` はすべて TypeScript へ移行済み。** 新規追加と既存ファイルの変更はいずれも `.ts` / `.tsx` にする。`dist/` 等のビルドで生成される JavaScript のみ例外とする。
- `package.json` の `main` / `exports`、既存 Bot の起動・テスト方式は維持する。Python 関連ファイルと `.py` の成果物は変更対象にしない。
- JS / TS 関連の変更後は `pnpm check` と該当テストを実行する。手書き JS は既存・新規を問わず `pnpm check:ts` で検出される。
