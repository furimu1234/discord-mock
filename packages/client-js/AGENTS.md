# JavaScript クライアント開発ルール

- ルートの `AGENTS.md` を遵守する。
- JS 側は pnpm 11 / Node.js 24.17+ を使用する。
- `disMockClient(existingClient)`、`disMockMixin(ClientClass)`、`disMockMixin(SapphireClient)` の双方を維持する。
- Client と SapphireClient の **公開** `emit` / `on` を利用する。クライアントの非公開フィールドに依存しない。
- 実 SDK への依存はテスト時だけとし、公開パッケージ利用者の `discord.js` / Sapphire のバージョンと競合させない。
- 通常の `client.login()` を Mock 接続に見せかけない。REST / Gateway / Voice が未実装の間は公開ドキュメントで明確に警告する。
- 単独で npm 向けにバージョンを付ける。公開可能になるまで `private: true` を維持する。
- `pnpm --filter @discord-mock/client-js test` と関連する `spec/` の検証を実行する。
