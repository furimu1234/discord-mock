# Mock Server 開発ルール
- ルートの `AGENTS.md` と本ルールに従う。
- REST / Gateway / CLI・既存テスト・新規テストはすべて TypeScript（`.ts`）で実装する。手書き `.js` / `.mjs` は追加しない。必要な公開 Discord API 仕様のみ参照し、非公開 API の解析はしない。
- 新規 `tests/*.test.ts` は TypeScript の型チェックと `pnpm --filter @discord-mock/server test` の対象にする。
- 本番 Discord トークン・URL・通信を受け付けない。localhost 以外へのバインドを禁止する。
- REST に未実装のエンドポイントがある場合は明示的に 404 とし、本番へフォールバックしない。
- Gateway は JSON encoding の基礎接続（Hello / Identify / Ready / Heartbeat）から段階的に拡充する。voice 音声互換は未対応であることを明記する。
- `pnpm build` は手動。配布後は `node apps/server/dist/discord-mock.cjs` で実行し、pnpm 不要。
- API を追加したときは `spec/` と JS・Python のテストを同じ PR で更新する。
