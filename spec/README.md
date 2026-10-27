# 共通 API 仕様

このディレクトリを、Web・JS・Python・Mock Server の共通契約の唯一の管理元とします。

- `openapi.yaml` は現時点でローカル `GET /health` のみ定義しています。
- 将来的に Discord REST の必要部分、Gateway イベント、Interaction ペイロード、Voice イベント、エラー形式、フィクスチャ形式等の独自仕様ファイルを分けて追加します。
- Discord の**公開** Developer Documentation を参照し、必要なレスポンス形式を独自に記述します。公式ドキュメントの文章やコードはライセンスを確認せずコピーしません。
- 仕様変更時は `apps/server`、`packages/client-js`、`packages/client-py` の該当テストを同じ PR で更新します。
- プロトコルが未実装の場合は「未対応」とし、動作互換を主張しません。
