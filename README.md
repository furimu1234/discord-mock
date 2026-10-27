# discord-mock

Discord Bot を手動・自動でテストするための **ローカル / 自己管理 VPS 専用** Mock 環境です。
**SaaS として提供しません。** 開発方針・規約遵守ルールは [AGENTS.md](AGENTS.md) に記載しています。

## モノレポ構成

```text
discord-mock/
├── AGENTS.md                      # 全体の仕様・セキュリティ・Discord 規約
├── package.json                   # pnpm スクリプト
├── pnpm-workspace.yaml            # JS のみワークスペース管理
├── apps/
│   ├── web/                       # テスト / 管理画面（現在プレビューのみ）
│   └── server/                    # Mock Server / CLI（現在ローカルHTTPのみ）
├── packages/
│   ├── client-js/                 # npm 向け JS クライアント（未公開）
│   └── client-py/                 # PyPI 向け Python クライアント（未公開）
├── spec/                          # 全言語共通 API 契約
├── tests/                         # 将来の横断互換テスト
└── .github/workflows/
    ├── test-web.yml
    ├── test-js.yml
    ├── test-py.yml
    ├── publish-npm.yml
    └── publish-pypi.yml
```

各ディレクトリの `AGENTS.md` はルートのルールを補完し、上書きしません。

## 起動（現在は構成確認用プレビュー）

Node.js 22+ / pnpm 11 を使用:

```bash
pnpm install
pnpm dev
# 必要なら: pnpm --filter @discord-mock/server dev -- --port 3001
```

CLI は `127.0.0.1:3000` に待ち受け、テスト画面 `/test`、管理画面 `/admin`、ヘルスチェック `/health` を提供します。
公開 IP では待ち受けません。VPS では SSH ポートフォワーディングなどの非公開アクセス経路を使用してください。

## テスト

```bash
pnpm test                           # Web / Server / JS の単体テスト
cd packages/client-py
uv sync
uv run ruff check .
uv run pytest
```

Python は pnpm ワークスペースに含めず、独立した `pyproject.toml` / uv プロジェクトとして管理します。

## 開発状況と公開方針

**現在はモノレポの土台と HTTP ヘルスチェックのみ動作します。** Discord REST API / Gateway / Voice、ダミーユーザー管理、DM、VC 音声、Bot のソース変更なしテストは未実装です。

- JS と Python のバージョンは個別管理します: 例 `js-v1.3.0` / `py-v1.2.0`。
- CI は変更のあった領域に応じて Web・JS・Python を個別に検証します。
- npm / PyPI の公開ワークフローは配置済みですが、**リリースは既定で無効**です。公開する段階で `ENABLE_CLIENT_RELEASE=true` の GitHub Actions リポジトリ変数、Trusted Publisher、リリース用 Environment、package metadata（JS の `private` フラグ解除と名前の確保など）を設定してください。
- Trusted Publishing には GitHub-hosted Runner と OIDC を使用します。自己管理 VPS の実行環境と、パッケージ公開時の CI 実行環境は別物です。
- Discord 公式 API の公開仕様から必要なレスポンス形式を独自に実装します。非公開 API や公式クライアント内部を解析しません。OSS 配布前には Discord Developer Support に互換サーバーの配布可否を確認する方針です。
