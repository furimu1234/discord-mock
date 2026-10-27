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

## SDK 直接ラップ・継承の互換テスト（実装済み）

- JS: `packages/client-js/tests/integration.test.mjs` で discord.js `Client` と Sapphire `SapphireClient` 実クラスを使い、`instanceof`、独自メソッド、イベント注入を検証します。
- Python: `packages/client-py/tests/test_integrations.py` で discord.py `Client` と `commands.Bot` を用いて `isinstance`、独自メソッド、非ログイン状態でのカスタムイベント配送を検証します。
- Mock 本体の Gateway / Voice 互換、通常のメッセージを使うコマンド発火、Sapphire Piece 自動ロードまでの統合テストは **未実装** です。
