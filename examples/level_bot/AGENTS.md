# level_bot 開発ルール

- ルートの `AGENTS.md` に従う。Bot・DB・統合テスト・Vitest テスト・新規スクリプトは TypeScript (`.ts`) で作成する。UI に JSX が必要なときのみ `.tsx` を認める。
- `packages/bot/src/commands/` に追加するコマンドは `.ts` とし、既存の自動検出・登録の仕組みを維持する。
- `scripts/demo.ts` も TypeScript とし、`pnpm demo` は `tsx` で直接実行する。`dist/*.mjs` はビルド成果物として維持し、手書き `.mjs` / `.js` は追加しない。
- `pnpm --filter @discord-mock/level-bot typecheck`、`pnpm --filter @discord-mock/level-bot lint`、`pnpm bot:test` で検証する。Bot 側の独自起動処理や Drizzle / PGlite の接続方式を不要に変更しない。

- ルート `pnpm bot` は UT の Web 実行、`pnpm bot:client` は Bot プロセス単体起動。`pnpm app` は有効な保存済みトークンがある場合 Bot を自動起動する。テストは別 Mock / DB で実行し、`/test` のチャットへ実行内容を送る。
- Web のテストケース実行 API は登録済みテストだけを起動し、ローカル管理認証と CSRF 検証を必須とする。任意コマンド実行 API に変更しない。

- UTの対象ユーザーは `test(name, { users: "all" | "login" | { id: "..." } | { ids: ["...", "..."] } }, async ({ bot, user, actor }) => {...})` の第2引数で指定する。`all` と `ids` はテスト本文を対象ユーザーごとに順次実行する。`actor` は1回につき1ユーザーで配列にはしない。`ids` は入力順を維持し、空配列・重複・未登録・BotのIDを拒否する。`bot.as(user)` は互換のため残すが、users指定を操作APIへ戻さない。
- `login` はブラウザの `/_ui/session` で選んだユーザーをCSRF検証済みの `/_ui/test-cases/run` からテスト実行へ渡す。任意IDの偽装リクエストを受け付けない。CLIからの実行時は `DISCORD_MOCK_SELECTED_USER_ID` を利用できる。

- Botテストでは `actor.sendMessage` による実際のイベント・Drizzle/pg更新を利用し、テスト終了時に実PGlite DBの全ユーザーテーブルを読み取り専用で収集してAppへ報告する。`bot.levels.set` による直接のセットアップも維持する。DBプロセスはテスト終了時に閉じ、App DBと分離する。
