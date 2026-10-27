# Python Discord Mock Client

`discord.py` の `discord.Client` / `commands.Bot` を既存どおり継承できます。`disMockClient` は既存 Client にイベント注入を行い、`mock_routes` は SDK の REST URL をテスト期間だけ Mock へ向けます。

```python
import asyncio
import discord
from discord_mock_client import disMockClient, mock_routes

client = discord.Client(intents=discord.Intents.none())
ut_client = disMockClient(client)


async def test_run():
    # 必ず mock_routes の内側で Login / Gateway 接続を始める
    with mock_routes("http://127.0.0.1:3000"):
        await client.start("mock_ここにCLI発行トークン")


# asyncio.run(test_run()) は手動停止が必要。個別の UT では別タスクで起動。
```

`discord.http.Route.BASE` は **discord.py の実装詳細**で、ライブラリの公開安定APIではありません。上書きは **プロセス全体**に及ぶため、別の Discord Client と混在してはいけません。この操作は開発・テストプロセスに限定し、`with` を抜けると必ず復元します。変更が入った SDK バージョンへの対応は個別に確認します。REST / Gateway の基礎動作以外は未対応です。

`DisMockMixin` と `disMockClass` のクラス継承 API も継続して利用できます。**Voice / Slash command / DM / 権限管理の完全な実装はまだありません。**

## より簡単なテスト接続方法

```python
ut_client = disMockClient(client, base_url="http://127.0.0.1:3000")
# Mock の起動により発行された mock_ トークンだけを受け付けます
await ut_client.start("mock_...")  # SDK停止まで待機。テストではタスク起動して終了時に close する
```

`ut_client.routes()` でも一時的な REST ルート差し替えを利用できます。この `start` は experimental で、特に discord.py の Gateway 圧縮やイベントモデルの完全互換は未検証です。

`tests/test_commands.py` では、実 `CommandTree.sync()` / `fetch_commands()` による引数なしコマンドのグローバル・Guild 登録をローカル Mock で検証します。先にルートで `pnpm build` してください。Node またはサーバー配布物がなければ、この REST 統合テストのみ skip します。CI では必要なビルドを明示的に行います。Python の Gateway 経由でのコマンド実行までは検証していません。
