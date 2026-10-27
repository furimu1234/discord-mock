/** Static TS-authored local preview; never loads assets from Discord or a CDN. */
export function renderPage(): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>discord-mock</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif}
body{background:#15161c;color:#efeff4;margin:2.5rem auto;padding:0 1rem;max-width:850px;line-height:1.7}
section{border:1px solid #444653;border-radius:.7rem;margin:1rem 0;padding:1rem}
a{color:#8fafef}code{background:#2c2f38;padding:.2rem}
</style></head><body><h1>discord-mock</h1>
<p>ローカル専用 Discord Bot テスト環境（互換サーバー開発中）</p>
<nav><a href="/test">テスト画面</a> / <a href="/admin">管理画面</a></nav>
<section><h2>Gateway / REST 開発プレビュー</h2>
<p>Mock REST: <code>/api/v10</code> / Gateway: <code>/gateway</code> / Health: <code>/health</code></p>
<p>音声プロトコル・Botコマンド完全互換・ダミーユーザーログイン画面は未実装です。</p>
</section>
<section><h2>利用上の注意</h2>
<p>Mock のテスト用トークンのみ許可します。Discord 本番の Bot トークンは使用しません。</p>
</section></body></html>`;
}
