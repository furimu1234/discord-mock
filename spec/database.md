# ローカル DB レコードビュー

`/database` は app が持つ PGlite のテーブルを参照する、Mock 独自の管理画面です。Discord API ではありません。ダークなテーブルブラウザーを独自実装し、Drizzle Studio 自体を組み込んだものではありません。

## ローカルセッション

DB タブを開くと、キー入力なしでローカルの参照用セッションを作成します。`POST /_admin/session` に空 JSON `{}` と `x-discord-mock-local: 1` を送り、Cookie を取得します。ダミーユーザーのセッション・Bot の `TOKEN` は使いません。これはローカルで操作する利用者に DB 参照を許すモードであり、リモート利用者の本人認証ではありません。管理キーのコピー・入力や URL への埋め込みは不要です。

| メソッド | パス | 動作 |
| --- | --- | --- |
| GET | `/_admin/session` | `{authenticated, databaseAvailable}`。認証済みなら `csrf` も返す |
| POST | `/_admin/session` | 空 JSON と専用ヘッダーでローカルセッションを作成・再利用。既存の JSON `{secret}` による取得も UT 向けに維持 |
| DELETE | `/_admin/session` | 管理 Cookie と `x-discord-mock-admin-csrf` を照合して失効する |
| GET | `/_admin/database/tables` | `{tables: [{schema, name, columnCount}]}` |
| GET | `/_admin/database/rows` | 以下の検索条件に対応するページを返す |

DB Cookie `discord_mock_admin` は HttpOnly・SameSite=Strict・Path=/_admin、有効期間1時間です。失効・app 再起動後は再読込で作り直します。読み取り API は UT 向けに `x-discord-mock-secret` でも認証できます。ダミー Cookie・ダミー CSRF・Bot トークンだけでは閲覧できず、この DB Cookie で `/_mock/*` のテスト管理操作を認可しません。

DB API とセッション作成は、Host がループバックかつ実際の待受ポートと一致する場合だけ許可します。Origin があれば同一オリジンに限定し、Sec-Fetch-Site が cross-site / same-site なら拒否します。セッション作成には JSON Content-Type と専用ヘッダー（または既存のキー）が必要です。CORS は許可しません。これによりローカルでの手入力を省きつつ、外部サイトのフォーム送信・別オリジン・DNS rebinding によるブラウザからの接続を拒否します。

## レコード取得

| クエリ | 範囲・既定値 |
| --- | --- |
| `schema`, `table` | 必須、各1〜128文字。カタログ上のユーザーテーブルだけを許可 |
| `offset` | 整数 0〜1,000,000、既定0 |
| `limit` | 整数 1〜100、既定50（画面は25 / 50 / 100） |
| `search` | 最大200文字。行の JSON 表現の部分一致、大文字小文字を区別しない。`%`・`_` は文字として検索 |
| `sort` | 存在する列名。省略時は主キー順 |
| `direction` | `asc` / `desc`、既定 `asc` |

応答は `{schema, table, columns, rows, totalRows, offset, limit, truncated}`。`columns` は `{name, type, nullable, primaryKey}` の配列、`rows` は同じ列順の値配列です。値は JSON の文字列・数値・真偽値・null。複合値は JSON 文字列、日時は ISO 文字列、バイナリは hex 文字列です。文字列はセルあたり4096文字、ページ合計256 Ki文字までに制限し、省略があれば `truncated: true` を返して画面にも示します。

`totalRows` は検索後の件数。範囲外の offset は最終ページに補正します。同値のソートには内部の行位置を加えてページ間の順序を安定させますが、更新をまたぐスナップショットは保持しません。明示的な「更新」で Bot の変更を再取得します。

SQL 文・接続 URL・データ更新の API は公開しません。識別子はカタログで照合して引用し、検索・limit・offset はパラメーター化します。PGlite 上の読み取り専用トランザクションと3秒の statement timeout で取得します。システムスキーマ・ビューは対象外。型によって比較演算が使えない列などの読み取り失敗は500とし、SQL・接続情報は返しません。

認証不足は403、不正な検索条件は400、未知のテーブル・列は404、DB 更新メソッドは405。DB プロバイダーを持たない単体 CLI では `databaseAvailable: false`、認証後の DB API は503です。コア配布物に PGlite の依存関係を増やしません。PGlite のデータは従来どおり app 終了までのインメモリ状態で、DB ビューの追加による永続化変更はありません。

実 PGlite / pg の読み書きとの一致、識別子の引用、入力制限、セッション分離は JS 統合テストで検証します。Python は固定プロバイダーを使う HTTP 契約テストです。Web は DOM フィクスチャで自動接続、表示、検索・ソート・ページ切替、アクセス失効後の遅延応答破棄を検証します。
