# discord-mock-client — discord.py integration

**discord.Client**、**commands.Bot**、ユーザー定義の Bot クラスを、インスタンスを渡す方法と継承する方法の双方で利用できます。discord.py の公開 `dispatch()` を使います。

> 現時点では **既存のイベントハンドラーにテストイベントを送る仕組み** と、Mock の `/health` のみ対応しています。REST / Gateway / Voice の接続先差し替え、commands.Bot のコマンド解析を含む完全再現、SDK の内部 `Message` / `Interaction` オブジェクトの生成は **未実装**です。

## 1. 既存インスタンスを渡す

```python
import asyncio
import discord
from discord_mock_client import disMockClient

client = discord.Client(intents=discord.Intents.none())
ut_client = disMockClient(client, base_url="http://127.0.0.1:3000")

@client.event
async def on_mock_test(payload):
    print(payload)

async def run_test():
    # login()/start()/run() ではなく、ローカルのイベント処理だけを実行する。
    async with client:
        ut_client.dispatch("mock_test", {"userId": "dummy-1"})
        await asyncio.sleep(0.1)

asyncio.run(run_test())
```

## 2. 独自 commands.Bot の継承

```python
import discord
from discord.ext import commands
from discord_mock_client import DisMockMixin, disMockClass

class MyBot(commands.Bot):
    def custom_method(self):
        return "original"

# 推奨: 明示的な Mixin による継承
class UtBot(DisMockMixin, MyBot):
    pass

bot = UtBot(command_prefix="!", intents=discord.Intents.none())
assert isinstance(bot, MyBot)
assert bot.mock.client is bot

# または動的な継承クラスファクトリ
class UtBot2(disMockClass(MyBot)):
    pass
```

Mixin は `MyBot.__init__` を差し替えません。Python の `@bot.event` / `on_...` の処理は通常の discord.py に任せます。関数形式には `dis_mock_client`、クラス形式には `dis_mock_class` のスネークケース別名もあります。

## 注意

- イベント名は `"message"` のように指定し、`"on_message"` は使用しません。
- `dispatch` は discord.py のイベントスケジュール処理です。非同期コンテキストが必要です。
- `commands.Bot` の `on_message` やコマンド処理は、discord.py が期待するネイティブ `discord.Message` と適切な状態を要求します。単なる dict によるコマンド実行互換性は未提供です。
- **通常の `client.login()`, `client.run()`, `client.start()` は本番 Discord にアクセスする可能性があるため、Mock テスト中に呼ばないでください。** ラッパーは SDK の接続メソッドを上書きしません。ネットワーク遮断はテスト実行環境で実施してください。
- `cd packages/client-py && uv sync && uv run ruff check . && uv run pytest` で discord.py 実クラスとのテストを実行します。
- PyPI 公開は未実施です。
