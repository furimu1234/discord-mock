# JavaScript / TypeScript Mock Client 開発ルール
- ルートの `AGENTS.md` に従う。
- ソース・新規テスト・補助スクリプトは TypeScript（`.ts`、必要な場合のみ `.tsx`）のみ。既存テストも TypeScript へ移行済み。Node 組み込みテストは `*.node.test.ts`、Vitest テストは `*.test.ts` で分離し、`tsconfig.test.json` で型チェックする。手書き `.mjs` / `.js` は追加しない。生成した JavaScript と型定義は `dist/` に出力して Git にコミットしない。
- discord.js と Sapphire の公開 `rest` オプションを利用する。非公開APIに依存しない。
- 既存インスタンス `disMockClient(client)` と継承 `disMockMixin(Base)` を維持する。
- REST の接続先は常にループバック。Gateway は Mock が返すURLを使用し、本番へフォールバックしない。
- 非対応の Voice / その他 Discord API 互換を動作済みと表示しない。
- pnpm は開発・ビルド時のみ。配布後の実行には不要。
