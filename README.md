# discord-mock

ローカル / 自己管理 VPS 専用の Discord Bot テスト環境。**SaaS として公開しません。**

## Monorepo

| 場所 | 実装言語 | 役割 |
| --- | --- | --- |
| apps/web | TypeScript | 管理・テスト画面（現状はプレビュー） |
| apps/server | TypeScript | Mock REST / Gateway サーバー、CLI |
| packages/client-js | TypeScript | discord.js / Sapphire SDK テストアダプター |
| packages/client-py | Python | discord.py テストアダプター |
| spec | OpenAPI / Markdown | 共通 API 契約 |
| tests | - | 将来のクライアント横断テスト |

## NixOS 開発環境（nix-shell）

現在の開発マシンで取得した NixOS のバージョン情報:

```json
{
  "nixosVersion": "26.05.12658.1f607aa79b63",
  "nixpkgsRevision": "1f607aa79b6356ed45d3cd3c8079c196e79efa2c"
}
```

リポジトリ直下の [`shell.nix`](shell.nix) に NixOS 向け開発ツールを定義しています。リポジトリに移動して **`nix-shell` と入力するだけ**で Node.js 24・pnpm 11・Python 3.13・uv がそのシェル内で利用可能になります。

```sh
cd discord-mock
nix-shell

# ここから nix-shell 内。ツールのパスが自動的に適用される
node --version
pnpm --version
python3 --version
uv --version

# 依存関係のセットアップは最初に必要なときだけ手動実行
pnpm install
uv sync --project packages/client-py

# ビルドも手動
pnpm build
pnpm test
uv run --project packages/client-py pytest

# nix-shell を抜ける（元のシェル環境へ戻る）
exit
```

- **NixOS の `environment.systemPackages`、`configuration.nix`、ユーザー全体の PATH は変更しません。** `node` / `pnpm` / `python3` / `uv` の追加は `nix-shell` の実行環境だけに適用します。
- `nix-shell` に入るだけでは `pnpm install`・`uv sync`・`pnpm build` は実行しません。依存ファイル（`node_modules`・Python の `.venv`）は手動セットアップ後もローカル作業ディレクトリに残ります。
- NixOS の uv には `UV_PYTHON` と `UV_PYTHON_DOWNLOADS=never` を設定し、Python 実行環境を Nixpkgs のものに限定します。通常は `corepack enable` は不要です（Nix の読み取り専用ストアを変更しません）。
- `pnpm` のバージョンは Nixpkgs の pnpm 11 系を使用し、プロジェクトの `packageManager` に記載された別のパッチバージョンを自動で取得しません。
- この `shell.nix` は、ホストで構成済みの `<nixpkgs>` を利用します。上記の nixpkgs リビジョンは **開発環境の記録**であり、このファイルでそのリビジョンを固定しているわけではありません。利用可能なパッケージバージョンはホストの Nixpkgs 設定によって変わることがあります。
- `<nixpkgs>` が見つからない場合、`nix-shell` を使うための Nix チャネル / `NIX_PATH` を構成してください。こちらもグローバルなパッケージの導入は不要です。

## 開発時の前提条件（Windows / Ubuntu / macOS / NixOS）

Node.js 24.17+、Corepack または pnpm 11。**開発時は pnpm 必須**、Python 側は uv を使用します。

```sh
# corepack コマンドがなければ Corepack を別途導入
corepack enable
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm dev
```

ビルドは**明示的に `pnpm build` を実行**したときのみ。通常の `pnpm dev` / `pnpm test` では勝手にビルドしません。

## ビルド済み成果物を使う（pnpm 不要）

`pnpm build` が生成した `apps/server/dist/discord-mock.cjs` は依存を束ねた Node.js スクリプトです。実行先に Node.js 24+ がインストールされていれば **pnpm / Corepack / TypeScript / node_modules は不要**です。

```sh
node apps/server/dist/discord-mock.cjs
node apps/server/dist/discord-mock.cjs --port 3001
```

Windows / Ubuntu / macOS では各 OS 用の Node.js を利用してください。**NixOS は Nixpkgs の Node.js 24 を利用**し、必要なら `nix shell nixpkgs#nodejs_24 -c node apps/server/dist/discord-mock.cjs` で起動します。これらはそれぞれ **Node.js 実行環境を別途必要とする方式**です。OS に依存しないネイティブ単体実行ファイルを配布する機能ではありません。

CLI はローカル URL、生成された `mock_` トークン、管理用シークレットを表示します。公衆 IP にはバインドできません。VPN / SSH ポートフォワード等でアクセスしてください。

## SDK の接続先差し替え

JavaScript / Sapphire: `disMockClient(client)` が `client.rest.options.api` を Mock URL へ変更し、`utClient.connect("mock_...")` が通常のログイン経路から Mock REST・Gateway に接続します。

Python: `disMockClient(client)` のラップおよび `DisMockMixin` に加え、`with mock_routes(local_url)` で REST の `Route.BASE` を一時変更し、`client.start("mock_...")` をそのブロックで実行できます。**この Python の変更は SDK 内部のバージョン依存箇所・プロセス全体への変更**で、並列利用はできません。実 Discord トークンは使わず、外向き通信もネットワーク的に遮断してください。

## 現在の実装範囲

REST: Gateway URL・Bot 自分自身・Guild / Channel / Message の一部。
Gateway: Hello / Identify / Ready / Guild Create / Heartbeat / Resume の一部。

Interaction の最小 Mock 管理 API にも対応しました。

**未対応:** 実音声を届ける Voice Gateway / UDP / RTP、DM、ダミーユーザーログイン、Interaction の完全なコマンド／ボタン処理、全 Discord REST 互換、Sapphire の Piece 完全起動。これらを実装済みと誤認させないでください。

独自 Mock 管理 API `/_mock/state` と `/_mock/dispatch` には CLI の管理用シークレットが必要です。データを保存する場合は `DISCORD_MOCK_STATE_PATH` で JSON パスを指定します。

## パッケージ公開

npm / PyPI は独立タグ・独立公開。公開ワークフローはデフォルト無効。設定する前に [AGENTS.md](AGENTS.md) の規約／ライセンス条件、Discord Developer Support への確認方針を参照してください。
