# JavaScript クライアント開発ルール

- ルートの `AGENTS.md` を遵守する。
- JS 側は pnpm 11 / Node.js 22+ を使用する。
- 既存 Bot のソース変更なしを目標とするが、discord.js 公開 API で接続先を切り替えられない場合は制約を明記する。
- REST / Gateway / Voice の互換性を混同せず、対応していないプロトコルを動作済みとしない。
- 単独で npm 向けにバージョンを付ける。公開可能になるまで `private: true` を維持する。
- `pnpm --filter @discord-mock/client-js test` と関連する `spec/` の検証を実行する。
