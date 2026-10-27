# Mock Server 開発ルール

ルートの `AGENTS.md` を必ず守る。

- Discord 公式の公開仕様に基づいて REST / Gateway / Voice / Interaction の互換動作を段階的に独自実装する。
- 本番 Discord API / Gateway / Voice に接続しない。未対応経路の本番フォールバックは禁止。
- デフォルトは `127.0.0.1` 待受とし、公衆向け無認証公開を導入しない。
- Web・JS・Python クライアントに共通する契約は `spec/` に記述する。実装変更時は関係する互換テストを更新する。
- JSON 保存・ダミーユーザーのセッション・権限・DM の分離はサーバー側で強制する。
- この段階で動くのは HTTP のヘルスチェックと UI プレビューだけであり、Discord 互換サーバーとは呼ばない。
- 関連変更では `pnpm --filter @discord-mock/server test` を実行する。
