# level_bot 開発ルール

- ルートの `AGENTS.md` に従う。Bot・DB・統合テスト・Vitest テスト・新規スクリプトは TypeScript (`.ts`) で作成する。UI に JSX が必要なときのみ `.tsx` を認める。
- `packages/bot/src/commands/` に追加するコマンドは `.ts` とし、既存の自動検出・登録の仕組みを維持する。
- `scripts/demo.ts` も TypeScript とし、`pnpm demo` は `tsx` で直接実行する。`dist/*.mjs` はビルド成果物として維持し、手書き `.mjs` / `.js` は追加しない。
- `pnpm --filter @discord-mock/level-bot typecheck`、`pnpm --filter @discord-mock/level-bot lint`、`pnpm bot:test` で検証する。Bot 側の独自起動処理や Drizzle / PGlite の接続方式を不要に変更しない。
