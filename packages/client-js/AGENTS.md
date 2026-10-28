# JavaScript / TypeScript Mock Client 開発ルール
- ルートの `AGENTS.md` に従う。
- ソース・新規テスト・補助スクリプトは TypeScript（`.ts`、必要な場合のみ `.tsx`）のみ。既存 `.mjs` テストは移行まで保持し、新規 `.mjs` は追加しない。新規 `.test.ts` は Vitest と `tsconfig.test.json` に含める。生成した JavaScript と型定義は `dist/` に出力して Git にコミットしない。
- discord.js と Sapphire の公開 `rest` オプションを利用する。非公開APIに依存しない。
- 既存インスタンス `disMockClient(client)` と継承 `disMockMixin(Base)` を維持する。
- REST の接続先は常にループバック。Gateway は Mock が返すURLを使用し、本番へフォールバックしない。
- 非対応の Voice / その他 Discord API 互換を動作済みと表示しない。
- pnpm は開発・ビルド時のみ。配布後の実行には不要。
