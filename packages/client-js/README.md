# @discord-mock/client-js — discord.js / Sapphire integration

既存の **discord.js Client / 独自 Client サブクラス / SapphireClient** に、ローカル Discord Mock のテストコントローラーを追加できます。SDK の公開 `emit()` を使用し、インスタンスや既存の継承関係は変更しません。

> 現在の対応範囲: ローカル Mock のヘルスチェックと、**既存イベントハンドラーへのテストイベント注入**。
> Mock の REST / Gateway / Voice はまだ実装されていません。SDK の `client.login()` は**本番 Discord に接続する可能性があるため、Mock テストで呼び出さないでください**。

## 1. 既存のインスタンスをそのまま渡す

```js
import { Client, GatewayIntentBits } from "discord.js";
import { disMockClient } from "@discord-mock/client-js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const utClient = disMockClient(client, { baseUrl: "http://127.0.0.1:3000" });

client.on("mockTestEvent", (payload) => console.log(payload));
utClient.dispatch("mockTestEvent", { userId: "dummy-1" });

console.log(await utClient.health());
// 本番ログインしない: client.login(realToken) は使用しない
```

## 2. discord.js を継承する

```js
import { Client, GatewayIntentBits } from "discord.js";
import { disMockMixin } from "@discord-mock/client-js";

class MyBot extends Client {
  myMethod() { return "same implementation"; }
}
class UtBot extends disMockMixin(MyBot) {}

const bot = new UtBot({ intents: [GatewayIntentBits.Guilds] });
bot.mock.dispatch("mockTestEvent", { id: "123" });
console.log(bot.myMethod());
```

`disMockClientClass(MyBot)` は `disMockMixin(MyBot)` と同じです。

## 3. Sapphire を使う場合

```js
import { SapphireClient } from "@sapphire/framework";
import { disMockClient, disMockMixin } from "@discord-mock/client-js";

const client = new SapphireClient({ intents: [] });
const utClient = disMockClient(client); // 既存インスタンス

class MySapphireClient extends SapphireClient {}
class UtSapphireClient extends disMockMixin(MySapphireClient) {}
const bot = new UtSapphireClient({ intents: [] });
bot.mock.dispatch("customTest", { userId: "dummy" });
```

Sapphire は `discord.js` の `Client` を継承しているため、共通アダプターで動作します。

## 注意事項

- `dispatch()` / `emit()` は **イベント通知のみ**。Discord SDK の本物の `Message` / `Interaction` の生成、キャッシュ・権限同期、Sapphire の Piece / Command の起動や REST レスポンスのエミュレーションはしません。該当ハンドラーが要求する型を渡してください。
- クラス拡張は `mock` プロパティを追加します。既存クラスに同名メンバーがないことを確認してください。
- `disMockClient` は既存の Client の `login`、`rest`、`ws`、Voice を上書きしません。外部への接続遮断はテスト環境側で実施してください。
- Discord の公開 API 仕様のみ使用します。非公開 API の解析・パッチには依存しません。
- `pnpm --filter @discord-mock/client-js test` で discord.js / Sapphire 実クラスとの継承・インスタンス互換テストを実行します。
- npm 公開は現段階では無効（`private: true`）です。
