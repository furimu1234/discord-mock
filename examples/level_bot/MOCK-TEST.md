# level_bot: upstream dev_container_ts_bot + embedded PostgreSQL

移植元: https://github.com/furimu1234/dev_container_ts_bot （MIT ライセンスは [LICENSE](LICENSE) に保存）

## 保持したもの

- `packages/bot/src/**` と `packages/db/src/**` の構成、実際の `events/leveling.ts`、`Container()`、`getLevel`・`createLeveling`・`updateLeveling`、Drizzle / `pg`。
- `src/main.ts` を共通の Client 作成・イベント登録・Ready 初期化として利用し、`src/local.ts` がローカル接続を担当します。**デモ Bot に Fake DB は差し込まない**。
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

`http://127.0.0.1:3000/test` のチャット欄は自動テスト専用です。下部のテストケース名ボタンを押すと個別の Vitest ケースを起動し、操作・返信・Embed・検証結果が同じチャットに表示されます。すべてのテストを実行するときは `pnpm bot` を別ターミナルから実行します。`/tests` にも実行履歴が表示されます。

```sh
pnpm bot
```

テストケースには独立した Mock・DB・Bot を用意するため、App の通常状態や PGlite データは変更しません。App 再起動時には結果一覧がリセットされます。ブラウザを開いたままでも再接続を試み、変更の反映に `pnpm build` と App 再起動、必要に応じたブラウザ更新が必要です。

`pnpm demo` は従来の単独デモ起動として引き続き利用できます。Bot 本体の `packages/bot/src/commands/` には従来どおり TypeScript のコマンドを追加できます。コマンド登録・DB 接続は今までの Drizzle / `pg` を使い、疑似 DB に差し替えません。

## E2E

コマンド返信の上には実行ユーザーと `/コマンド名` を表示します。サイドバーの「データベース」からは、キー入力なしで Bot が更新する `example.lvl` を表形式で参照できます。読み取り専用で検索・並び替え・ページ切替・手動更新に対応します。app を止めると DB が消える動作は変わりません。

`pnpm bot:client` は `bot.lock` で同じ app 保存先への重複起動を拒否します。初期返信を複数の Bot が同時に送った場合も、Mock は1件だけを受理し、2件目からは `40060` を返します。別のコマンド実行として送信された返信までまとめる処理は行いません。

app を先に Ctrl+C で停止しても、接続済み Bot は DB の切断イベントまたは `/health` の停止を検知して終了します。DB 接続エラーのオブジェクト全体は出力しません。SDK と DB の終了処理を開始し、SDK の再接続待ちが長引いた場合も最大3秒の待機後にロックを解放して CLI を終了します。通常は app が Bot を自動起動します。手動で分ける場合のみ app → `pnpm bot:client` の順です。実際の SIGINT、DB 使用後の切断、DB 未使用時の停止検知、同じ保存先での再起動をテストします。

静的チェックはルートの `pnpm check`、サンプルだけなら `pnpm --filter @ex/bot typecheck`・`pnpm --filter @ex/db typecheck`・`pnpm --filter @discord-mock/level-bot typecheck`・`pnpm --filter @discord-mock/level-bot lint` で実行できます。ビルド済みファイルに依存せず、Bot 本体と Drizzle 設定も検査します。

```sh
pnpm sample:test
```

別の Mock/DB/Bot を起動し、ブラウザ API から2通投稿して、本物の PostgreSQL クエリでレベル 2 → 3 を確認します。Bot を別プロセスで起動・再起動するケースと、app の再起動でトークンを再利用するケースも実行します。保存先・接続先は手動起動中の app と分離しています。

`/admin` はまだ簡易画面です。DM / VC の模擬および Discord 全 API の互換は未実装です。

## Bot の UT

```sh
pnpm bot:test
```

Bot の機能だけをまとめて検証します。app を別に起動する必要はありません。テストはすべて TypeScript です。

- `tests/bot/showLvl.test.ts`: 投稿してから `/レベル確認` を実行する流れ、Guild と実行者の絞り込み、未登録ユーザーの現在の動作。
- `tests/bot/leveling.test.ts`: 投稿ごとのレベル更新と、投稿していない人のレベルが変わらないこと。
- `tests/helpers/bot-test.ts`: 本物の Bot・PGlite・pg / Drizzle・Mock の準備、後片付け、Web への実行結果の反映。

テスト本文では HTTP ヘッダー・接続先・DB 起動処理を書く必要はありません。

```ts
import { test, expect } from '../helpers/bot-test.js';

test('レベル確認で7を返す', async ({ bot }) => {
  await bot.levels.set(bot.alice, 7);
  const reply = await bot.as(bot.alice).command('レベル確認');
  expect(reply.embeds[0].fields?.[0].value).toBe('7');
});
```

今後の機能も `tests/bot/` に `*.test.ts` を追加すれば `pnpm bot:test` で実行します。Bot のソースは直接実行し、テスト時に暗黙のビルドを行いません。

起動中の app に表示したい場合は `pnpm bot` を実行します。**`http://127.0.0.1:3000/test` を開いたままでも**、テストの実行内容・ステップ・メッセージ・Bot の返信・成功／失敗がチャット欄へリアルタイムで反映されます。`/tests` では過去の実行一覧・詳細も確認できます。通常の `pnpm bot:test` も app があれば自動で反映します。表示先は runtime.json の URL、または DISCORD_MOCK_REPORT_URL を使用します。テストは独立した Mock/DB を使用し、普段のチャットや DB は変更しません。結果は app が起動している間、最大20件保持します。Web の変更を反映するには `pnpm build` と `pnpm app` の再起動、および開いている `/test` の再読み込みが必要です。

`pnpm sample:test` は Bot に加えて `tests/integration/` の app・DB・起動処理も検証します。`pnpm automation:test` は SDK の自動テスト例と Bot テストの両方を実行します。既存の `pnpm level:test` / `pnpm level:test:web` は新コマンドの別名として利用できます。
