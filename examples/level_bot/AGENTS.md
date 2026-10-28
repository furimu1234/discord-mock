# level_bot 開発ルール

- ルートの `AGENTS.md` に従う。Bot・DB・統合テスト・Vitest テスト・新規スクリプトは TypeScript (`.ts`) で作成する。UI に JSX が必要なときのみ `.tsx` を認める。
- `packages/bot/src/commands/` に追加するコマンドは `.ts` とし、既存の自動検出・登録の仕組みを維持する。
- `scripts/demo.ts` も TypeScript とし、`pnpm demo` は `tsx` で直接実行する。`dist/*.mjs` はビルド成果物として維持し、手書き `.mjs` / `.js` は追加しない。
- `pnpm --filter @discord-mock/level-bot typecheck`、`pnpm --filter @discord-mock/level-bot lint`、`pnpm bot:test` で検証する。Bot 側の独自起動処理や Drizzle / PGlite の接続方式を不要に変更しない。

- ルート `pnpm bot` はUTのWeb実行、`pnpm bot:client` はBot単体起動。`pnpm app` は保存済みトークンでBotを自動起動する。UTはケースごとに別Mock・Botを使うがDBはAppのPGliteと共有し、全ケース間で持続する。
- Web のテストケース実行 API は登録済みテストだけを起動し、ローカル管理認証と CSRF 検証を必須とする。任意コマンド実行 API に変更しない。

- UTの対象ユーザーは `test(name, { users: "all" | "login" | { id: "..." } | { ids: ["...", "..."] } }, async ({ bot, actor }) => {...})` の第2引数で指定する。`all` と `ids` はテスト本文を対象ユーザーごとに順次実行する。`actor` は1回につき1ユーザーで配列にはしない。`actor.id`・`actor.username` などのユーザー情報と `actor.sendMessage`・`actor.command` を同じオブジェクトに持たせ、DBの取得・設定にも `bot.levels.get(actor)` / `bot.levels.set(actor, level)` を使う。コンテキストから別の `user` は渡さない。`ids` は入力順を維持し、空配列・重複・未登録・BotのIDを拒否する。`bot.as(user)` は互換のため残すが、users指定を操作APIへ戻さない。
- `login` はブラウザの `/_ui/session` で選んだユーザーをCSRF検証済みの `/_ui/test-cases/run` からテスト実行へ渡す。任意IDの偽装リクエストを受け付けない。CLIからの実行時は `DISCORD_MOCK_SELECTED_USER_ID` を利用できる。

- Bot UTは通常 `actor.sendMessage` → 実Botイベント → pg/Drizzle 更新を検証する。初期条件や例外検証に限り、任意で `bot.levels.set(actor, level, guildId?)` による共有PGliteへの直接設定も利用できる。対象Guildのレコードを挿入・更新するため後続テストにも値が残り、ケースごとにDBを初期化しない。Appがない場合はVitest globalSetupで共有一時PGliteを作り全ケース終了後に閉じる。

- `LocalTestCaseRunner` のケース収集は正規表現ではなくTypeScript構文解析を使い、静的 `describe` のネストと `test` / `it` を解析する。セレクト表示は「親 › 子 › ケース」、Vitestの `--testNamePattern` は親から末端までの完全名をエスケープして前後一致で指定し、同名の別階層ケースを誤実行しない。`describe.each`・動的タイトル等は収集しない。
