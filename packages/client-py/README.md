# discord-mock-client (Python preview)

Python テストハーネス向けの最小クライアントです。`DiscordMockClient.health()` のみ実装されています。
discord.py から Mock への REST / Gateway / Voice 接続先差し替えは **未実装**です。

```bash
cd packages/client-py
uv sync
uv run ruff check .
uv run pytest
```

PyPI 公開は、対応機能・名称・規約面と Trusted Publisher の設定を確認してから明示的に有効化します。JavaScript パッケージとは独立してバージョンを管理します。
