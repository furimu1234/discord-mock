# discord.js / Sapphire Mock Client (TypeScript)

`disMockClient(client)` accepts an existing discord.js `Client` or Sapphire `SapphireClient` and **changes the REST base URL** on that instance to localhost. Discord.js resolves its Gateway host via `/gateway/bot`; our server returns a local `ws://` URL.

```ts
import { Client } from "discord.js";
import { disMockClient, disMockMixin } from "@discord-mock/client-js";

const client = new Client({ intents: [], rest: {api:"http://127.0.0.1:3000/api"} });
const utClient = disMockClient(client);
await utClient.connect("mock_<CLIが発行するトークン>");

class MyBot extends Client {}
class UtBot extends disMockMixin(MyBot) {}
const bot = new UtBot({ intents: [] });
await bot.mock.connect("mock_<CLIが発行するトークン>");
```

SapphireClient も `disMockClient` / `disMockMixin` で同様に利用できます。**REST と基本 Gateway ハンドシェイクのみ**実装中。コマンド・モデル・音声の完全互換はありません。SDK が別経路に通信する場合に備えて、テスト実行環境は外向き通信をネットワークで遮断してください。

開発: `corepack enable && pnpm install && pnpm build`。
配布・利用: 出力 `dist/index.js` を Node.js から読み込みます。pnpm は不要です。SDK はアプリ側の依存として必要です。
