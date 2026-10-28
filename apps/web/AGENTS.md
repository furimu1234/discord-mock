# Web 開発ルール
- ルートの `AGENTS.md` を守る。
- ブラウザ向け表示・ロジック・新規テストを TypeScript（`.ts`、JSX が必要な場合のみ `.tsx`）に統一する。既存テストも含めて `.ts` に統一し、手書き `.mjs` / `.js` は追加しない。新規テストは `tsconfig.test.json` と `pnpm --filter @discord-mock/web test` で検証する。Mock の真の状態は Server が管理する。
- ダミーユーザーと管理者の権限は区別する。DM と権限をブラウザだけで保護しない。
- 外部サービス・Discord 本番のトークンにアクセスしない。
- テスト画面はローカルの TypeScript UI。ダミーユーザー切り替え・投稿はセッション Cookie + CSRF トークンで保護し、発火した MESSAGE_CREATE は Mock Gateway 経由で Bot に渡す。Bot の REST 投稿は SSE でブラウザへ反映する。管理画面の CRUD、DM、VC 音声はまだ未実装。
