# Web 開発ルール
- ルートの `AGENTS.md` を守る。
- ブラウザ向け表示・ロジックを TypeScript に統一する。Mock の真の状態は Server が管理する。
- ダミーユーザーと管理者の権限は区別する。DM と権限をブラウザだけで保護しない。
- 外部サービス・Discord 本番のトークンにアクセスしない。
- テスト画面はローカルの TypeScript UI。ダミーユーザー切り替え・投稿はセッション Cookie + CSRF トークンで保護し、発火した MESSAGE_CREATE は Mock Gateway 経由で Bot に渡す。Bot の REST 投稿は SSE でブラウザへ反映する。管理画面の CRUD、DM、VC 音声はまだ未実装。
