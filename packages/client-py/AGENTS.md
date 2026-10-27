# Python クライアント開発ルール

- ルートの `AGENTS.md` を遵守する。
- 依存管理と実行には **uv**、Lint には **Ruff**、テストには **pytest** を使用する。
- `cd packages/client-py && uv sync && uv run ruff check . && uv run pytest` を検証の基本とする。
- 公開先は **PyPI** とし、JS クライアントとは独立したバージョンと `py-vX.Y.Z` タグを使用する。
- `discord.py` の公開された拡張ポイントを利用し、非公開 API の解析・改変に依存しない。
- 実装していない REST / Gateway / Voice 互換を保証しない。
