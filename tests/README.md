# クライアント互換性テスト

`apps/server/tests/` は Mock Server 単体、`apps/web/tests/` は UI 単体、
`packages/client-js/tests/` と `packages/client-py/tests/` はそれぞれのクライアント単体の検証を担当します。

この `tests/` は、両クライアント・Mock Server・将来の Discord Bot SDK を横断する統合・互換テスト用です。

## 今後のテストマトリクス（未実装）

1. 共通フィクスチャを読み込み、Mock の REST JSON 形式・エラーを両言語で検証
2. Bot SDK の REST 接続先を Mock へ変更し、本番 Discord へ通信しないことを検証
3. Gateway の Hello / Identify / Heartbeat / Dispatch とユーザー操作の結び付きを検証
4. ユーザー別 DM、チャンネル権限、ボタン操作・コマンド実行者を検証
5. Voice 接続先と VC 参加・退出に伴う音声配信停止を検証

現時点で対応済みなのはヘルスチェックの単体テストのみです。
