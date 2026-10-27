# Python クライアント開発ルール

- ルートの `AGENTS.md` を遵守する。
- 依存管理と実行には **uv**、Lint には **Ruff**、テストには **pytest** を使用する。
- `DisMockClient(existingClient)` / `disMockClient(existingClient)` / `class UtBot(DisMockMixin, MyBot)` / `class UtBot(disMockClass(MyBot))` を維持する。
- discord.Client / commands.Bot の **公開された** `dispatch()` とイベント API を利用し、SDK の非公開キャッシュ・内部 Gateway を書き換えない。
- `cd packages/client-py && uv sync && uv run ruff check . && uv run pytest` を基本検証とする。
- `discord.py` はテスト時の dev 依存にする。Mock クライアントの利用者に SDK のインストールを強制しない。
- 公開先は **PyPI** とし、JS クライアントとは独立したバージョンと `py-vX.Y.Z` タグを使用する。
- `login()/start()/run()` が実 Discord と通信する可能性を説明し、ソース変更なしの完全接続互換とは表示しない。
