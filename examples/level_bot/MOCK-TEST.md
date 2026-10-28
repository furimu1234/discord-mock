# level_bot: upstream dev_container_ts_bot + embedded PostgreSQL

移植元: https://github.com/furimu1234/dev_container_ts_bot （MIT ライセンスは [LICENSE](LICENSE) に保存）

## 保持したもの

- `packages/bot/src/**` と `packages/db/src/**` の構成、実際の `events/leveling.ts`、`Container()`、`getLevel`・`createLeveling`・`updateLeveling`、Drizzle / `pg`。
- `packages/bot/src/main.ts` は変更せず、`packages/bot/src/testClient.ts` が `disMock.Client(client, main)` を使ってローカル接続・Ready 初期化の待機を担当します。**デモ Bot に Fake DB は差し込まない**。
- Node 24 / pnpm 11 用 Dev Container を `.devcontainer/` に維持。元の manifest は `upstream.package.json` と `upstream.pnpm-workspace.yaml` に保存。

## 修正したバグ

- PostgreSQL の `userId` 列名が `server_id` と重複していたため `user_id` に修正
- Bot が人間のメッセージを無視していた `message.author.bot` 判定を修正
- `Container()` がメッセージごとに新しい `pg.Pool` を生成していた部分を1つのプールに集約
- `TOKEN` / `POST_URL` の評価タイミングを起動時に変更
- `pnpm bot` が別の Client を作り、`main.ts` の Ready ハンドラーを登録していなかった問題を修正。ログイン完了に加え、Ready の非同期コマンド登録完了も待ちます。
- 既定の接続先を使う `new REST()` を廃止し、Mock に設定済みの `client.rest` から登録します。

## ブラウザでテストを実行する（推奨）

```sh
pnpm install
pnpm build
pnpm app
```

`pnpm app` は Mock REST / Gateway、Web、PGlite を起動します。初回は `.discord-mock-data/credentials.json` にテスト用トークンを発行し、**保存済みのトークンがある次回起動から** Bot クライアントを自動起動します。既存の `.env` に設定された `TOKEN` が保存済みトークンと違う場合は、app は起動したまま Bot のみ起動を見送り、`pnpm bot:test` を使った設定確認を案内します。Bot 単体を手動起動する場合は `pnpm bot:client` を使用してください。

初回からすべてを起動する場合は、リポジトリ直下で次を実行します。起動ファイルは別名に変更しても使えます。

```sh
pnpm --dir examples/level_bot exec tsx --tsconfig packages/bot/tsconfig.json packages/bot/src/testClient.ts
```

`testClient.ts` の `runTestClient(import.meta.url, ...)` が実行元を判定し、Mock・画面・PGlite・Bot を起動します。同じファイルへ `--test` を付けると CLI テスト、`--test-web` を付けると起動済み App へのテスト実行になります。import 時には設定の登録だけを行います。従来の `src` にあった起動・DB・プロセス監視と、Vitest 設定は `dismock` の配布物が担当し、利用側には不要です。Bot 固有のスキーマ・接続・検証 API だけをこの起動ファイルへ残しています。

`http://127.0.0.1:3000/test` は Discord 風の自動テスト画面です。右側「ユーザー」タブで Alice / Bob などを切り替えると、UT ソースの `users: "login"` で指定されたユーザーとして操作を実行します。左のチャンネル一覧でチャットを選択でき、中央にはダミーユーザーの投稿・Bot の返信・Embed のみ表示します。テスト開始・検証ステップ・合否は右の独立した実行ログに表示します。下部の独自リストでテストケースを矢印キーやマウスで選び、Enterまたはダブルクリックすると個別の Vitest ケースを起動します。実行ボタンはなく、実行した行の四角い枠に「●」を3秒間表示します。スクロールバーは非表示ですが、ホイールやタッチで一覧をスクロールできます。すべてのテストを実行するときは `pnpm bot` を別ターミナルから実行します。`/tests` にも実行履歴が表示されます。

```sh
pnpm bot
```

テストケースはMock・Botを分離しますがDBはAppのPGliteと共有するため、テスト操作で作ったレコードは次のケースにも残ります。App 再起動時には結果一覧がリセットされます。ブラウザを開いたままでも再接続を試み、変更の反映に `pnpm build` と App 再起動、必要に応じたブラウザ更新が必要です。

`pnpm demo` は従来の単独デモ起動として引き続き利用できます。Bot 本体の `packages/bot/src/commands/` には従来どおり TypeScript のコマンドを追加できます。コマンド登録・DB 接続は今までの Drizzle / `pg` を使い、疑似 DB に差し替えません。

## E2E

コマンド返信の上には実行ユーザーと `/コマンド名` を表示します。サイドバーの「データベース」からは、キー入力なしで Bot が更新する `example.lvl` を表形式で参照できます。読み取り専用で検索・並び替え・ページ切替・手動更新に対応します。app を止めると DB が消える動作は変わりません。

`pnpm bot:client` は `bot.lock` で同じ app 保存先への重複起動を拒否します。初期返信を複数の Bot が同時に送った場合も、Mock は1件だけを受理し、2件目からは `40060` を返します。別のコマンド実行として送信された返信までまとめる処理は行いません。

app を先に Ctrl+C で停止しても、接続済み Bot は `/health` の停止を検知して終了します。DB 接続エラーのオブジェクト全体は出力しません。SDK と DB の終了処理を開始し、SDK の再接続待ちが長引いた場合も最大3秒の待機後にロックを解放して CLI を終了します。通常は app が Bot を自動起動します。手動で分ける場合のみ app → `pnpm bot:client` の順です。実際の SIGINT、DB 使用後の切断、DB 未使用時の停止検知、同じ保存先での再起動をテストします。

静的チェックはルートの `pnpm check`、サンプルだけなら `pnpm --filter @ex/bot typecheck`・`pnpm --filter @ex/db typecheck`・`pnpm --filter @discord-mock/level-bot typecheck`・`pnpm --filter @discord-mock/level-bot lint` で実行できます。ビルド済みファイルに依存せず、Bot 本体と Drizzle 設定も検査します。

```sh
pnpm sample:test
```

`pnpm sample:test` は利用側の Bot テストを実行します。別プロセスの起動・再起動やトークン再利用、ブラウザ API からの投稿と実際の PostgreSQL クエリを通した検証は、ライブラリ側の `pnpm --filter dismock test:integration` で実行します。保存先・接続先は手動起動中の app と分離しています。

`/admin` はまだ簡易画面です。DM / VC の模擬および Discord 全 API の互換は未実装です。

## Bot の UT

```sh
pnpm bot:test
```

Bot の機能だけをまとめて検証します。app を別に起動する必要はありません。テストはすべて TypeScript です。

- `tests/bot/showLvl.test.ts`: 投稿してから `/レベル確認` を実行する流れ、Guild と実行者の絞り込み、未登録ユーザーの現在の動作。
- `tests/bot/leveling.test.ts`: 投稿ごとのレベル更新と、投稿していない人のレベルが変わらないこと。
- `dismock/e2e`: Mock の準備、対象ユーザーの解決、後片付け、Web への実行結果の反映。Bot 固有の DB 検証は `packages/bot/src/testClient.ts` の `runTestClient()` へ登録。

テスト本文では HTTP ヘッダー・接続先・DB 起動処理を書く必要はありません。レベルの直接指定は必要なケースでだけ行い、通常は投稿による増分を検証してください。

```ts
import { test, expect } from 'dismock/e2e';

test("レベル確認で7を返す", { users: "login" }, async ({ bot, actor }) => {
  await bot.levels.set(actor, 7); // 任意で直接設定
  const reply = await actor.command("レベル確認");
  expect(reply.embeds[0].fields?.[0].value).toBe("7");
});
```

今後の機能も `tests/**/*.test.ts` に追加すれば `pnpm bot:test` で実行します。`tests/bot` の名前は固定ではなく、`tests` 直下にも任意のサブフォルダーにも配置できます。利用側の `tests` にはテストケースだけを置きます。Bot のソースは直接実行し、テスト時に暗黙のビルドを行いません。

起動中の app に表示したい場合は `pnpm bot` を実行します。**`http://127.0.0.1:3000/test` を開いたままでも**、ユーザー投稿と Bot の返信がチャットに、テストの実行ステップと成功／失敗が右側の実行ログにリアルタイムで反映されます。`/tests` では過去の実行一覧・詳細も確認できます。通常の `pnpm bot:test` も app があれば自動で反映します。表示先は runtime.json の URL、または DISCORD_MOCK_REPORT_URL を使用します。テストは独立したMockを使用しますが、DBはApp本体と共有し、実際のBot更新が反映されます。結果は app が起動している間、最大20件保持します。Web の変更を反映するには `pnpm build` と `pnpm app` の再起動、および開いている `/test` の再読み込みが必要です。

`pnpm sample:test` は利用側の Bot テストを実行します。app・DB・起動処理の統合テストは `packages/client-js/tests/level-bot/` に移し、`pnpm --filter dismock test:integration` で検証します。`pnpm automation:test` は SDK の自動テスト例と Bot テストの両方を実行します。既存の `pnpm level:test` / `pnpm level:test:web` は新コマンドの別名として利用できます。

### UT の実行ユーザーを test() で指定

`test("ケース名", { users: "login" }, async ({ bot, actor }) => { ... })` のように、第2引数でテスト対象を指定します。

```ts
// /test の右側でログインしたユーザーとして実行
test("レベル確認", { users: "login" }, async ({ bot, actor }) => {
  await bot.levels.set(actor, 7);
  const reply = await actor.command("レベル確認");
  expect(reply.embeds[0].fields?.[0].value).toBe("7");
});

// 全ダミーユーザー（Bot除外）について同じ検証を順次実行
test("全員の投稿", { users: "all" }, async ({ actor }) => {
  await actor.sendMessage(`${actor.username} から投稿`);
});

// ユーザー ID を明示
test("指定ユーザー", { users: { id: "123456789000000099" } }, async ({ actor }) => {
  await actor.sendMessage("ID指定の投稿");
});

// 複数IDでテスト本文を順次実行
test("複数ID", { users: { ids: ["123456789000000098", "123456789000000099"] } }, async ({ actor }) => {
  await actor.sendMessage(`${actor.username} の投稿`);
});
```

`actor` は対象ユーザーの情報（`id`・`username` など）と投稿・コマンド実行の操作をまとめたオブジェクトです。`user` を別に受け取る必要はなく、`bot.levels.get(actor)` や `bot.levels.set(actor, level)` にも同じオブジェクトを渡せます。`bot.levels.set(actor, ...)` などの状態準備も同じユーザーを参照します。`"all"` では同じテスト本文を各ユーザーについて順に実行します。従来の `bot.as(user)` も残していますが、テスト実行対象は各操作ではなく `test()` の第2引数で指定します。

`"login"` は `/test` 右側の「ユーザー」タブからログイン先を変更したユーザーです。左クリックでロール等のプロフィール、右クリックでIDコピーとログイン切替を操作できます。初期ダミーユーザーは10人で、ログは「実行ログ」タブにあります。CLIで `pnpm bot` を実行するときは既定の Alice を使い、`DISCORD_MOCK_SELECTED_USER_ID` で上書きできます。未知のIDやBotアカウントにはフォールバックしません。



### 共有DBとチャンネル作成

`pnpm app` 起動中のBotテストは、各テストでMock・Botを独立して立ち上げつつ、**DBはAppのPGliteを全テストで共有**します。通常は `actor.sendMessage()` を通じたBot本体の処理でレコードを更新しますが、**任意で `bot.levels.set(actor, level, guildId?)` による直接設定もできます**。直接設定は実際の共有PGliteのレコードを挿入・更新し、後続のケースにも残ります。期待値はテスト前のレベルからの増加数で判定します。結果のレコードは `/database` の「AppのDB」に即時反映し、テストをまたいで保持します。App停止時にはPGliteを破棄します。

Appを起動せず `pnpm bot:test` する場合はVitest実行全体で単一の一時PGliteを共有し、全テスト終了時に閉じます。Mockのチャットは独立したまま結果表示用に報告されます。

`/test` ではチャットだけがスクロールし、右側のユーザーを右クリックして開いたメニュー・プロフィールは外側クリックで閉じます。左サイドバーの「＋」からテキストチャンネルを作成できます。作成したチャンネルは次のテストMockにも利用可能な状態で引き継ぎます。

### ネストした describe とテストケースの選択

`/test` 下部のテストケース一覧には、テストコードの `describe` 階層が `親 › 子 › テスト名` 形式で表示されます。階層名全体を使ってVitestの対象を絞るため、別の `describe` 内で同じ `test` 名を使用しても選択できます。

```ts
describe("/レベル確認", () => {
  describe("直接設定", () => {
    test("レベルを確認", { users: "login" }, async ({ bot, actor }) => {
      await bot.levels.set(actor, 7);
      const reply = await actor.command("レベル確認");
      expect(reply.embeds[0].fields?.[0].value).toBe("7");
    });
  });
});
```

この場合、テストケース一覧には `/レベル確認 › 直接設定 › レベルを確認` と表示されます。静的な文字列リテラル名の `describe` / `test` / `it` に対応します。`describe.each` / `test.each` など実行時生成のテストは個別一覧の対象外です。全テストの実行は従来どおり `pnpm bot` で行えます。
