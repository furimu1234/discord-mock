import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { startApp } from '../dist/app-runtime.mjs';

test('DB explorer reads the live PGlite records with separate admin auth and bounded safe queries', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'discord-mock-db-'));
  let app;
  let pool;
  try {
    app = await startApp({ port: 0, dataDir: directory });
    const { mock, database } = app;
    const request = (path, options) => fetch(`${mock.url}${path}`, options);
    const dummyResponse = await request('/_ui/session');
    const dummy = await dummyResponse.json();
    const dummyCookie = dummyResponse.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/database')).status, 200);
    assert.deepEqual(await (await request('/_admin/session')).json(), { authenticated: false, databaseAvailable: true });
    for (const headers of [{}, { cookie: dummyCookie, 'x-discord-mock-csrf': dummy.csrf }, { authorization: `Bot ${mock.token}` }]) {
      assert.equal((await request('/_admin/database/tables', { headers })).status, 403);
    }
    const json = { 'content-type': 'application/json' };
    assert.equal((await request('/_admin/session', { method: 'POST', headers: json, body: JSON.stringify({ secret: mock.token }) })).status, 403);
    assert.equal((await request('/_admin/session', { method: 'POST', headers: { ...json, origin: 'http://localhost:5555' }, body: JSON.stringify({ secret: mock.adminSecret }) })).status, 403);
    const login = await request('/_admin/session', { method: 'POST', headers: json, body: JSON.stringify({ secret: mock.adminSecret }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/_admin; Max-Age=3600/);
    const session = await login.json();
    const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };

    // Write using the same PostgreSQL wire endpoint used by the Bot's pg/Drizzle code.
    pool = new pg.Pool({ connectionString: database.dsn, max: 1 });
    await pool.query('INSERT INTO example.lvl (server_id, user_id, lvl) VALUES ($1, $2, $3), ($1, $4, $5)', ['guild', 'Alice', 5, 'Bob', 2]);
    await database.db.exec('CREATE SCHEMA "odd""schema"; CREATE TABLE "odd""schema"."table""name" ("key""column" integer PRIMARY KEY, text_value text, payload jsonb, missing text);');
    await database.db.query('INSERT INTO "odd""schema"."table""name" VALUES ($1, $2, $3, NULL), ($4, $5, $6, NULL)', [1, '100%_literal', { test: '<script>' }, 2, 'other', {}]);
    const tables = await (await request('/_admin/database/tables', { headers })).json();
    assert.ok(tables.tables.some((table) => table.schema === 'example' && table.name === 'lvl' && table.columnCount === 4));
    assert.equal(tables.tables.some((table) => table.schema.startsWith('pg_') || table.schema === 'information_schema'), false);
    const rows = async (parameters) => request(`/_admin/database/rows?${new URLSearchParams(parameters)}`, { headers });
    const query = { schema: 'example', table: 'lvl', sort: 'lvl', direction: 'desc', limit: '1' };
    let page = await (await rows(query)).json();
    assert.equal(page.totalRows, 2);
    assert.deepEqual(page.columns.map((column) => column.name), ['id', 'server_id', 'user_id', 'lvl']);
    assert.equal(page.columns[0].primaryKey, true);
    assert.equal(page.columns[0].nullable, false);
    assert.equal(page.rows[0][2], 'Alice');
    page = await (await rows({ ...query, offset: '1' })).json();
    assert.equal(page.rows[0][2], 'Bob');
    page = await (await rows({ ...query, search: 'alice' })).json();
    assert.equal(page.totalRows, 1);
    assert.equal(page.rows[0][3], 5);
    const unusual = { schema: 'odd"schema', table: 'table"name', sort: 'key"column', search: '%_' };
    page = await (await rows(unusual)).json();
    assert.equal(page.totalRows, 1, 'wildcards are searched literally');
    assert.deepEqual(page.rows, [[1, '100%_literal', '{"test":"<script>"}', null]]);
    assert.equal((await rows({ ...unusual, search: "' OR true; DROP TABLE example.lvl; --" })).status, 200);
    assert.equal((await rows({ ...query, table: 'lvl; DROP TABLE example.lvl; --' })).status, 404);
    assert.equal((await rows({ ...query, sort: 'lvl; DROP TABLE example.lvl; --' })).status, 404);
    for (const invalid of [{ limit: '101' }, { offset: '-1' }, { search: 'x'.repeat(201) }, { direction: 'asc; DROP TABLE example.lvl' }]) {
      assert.equal((await rows({ ...query, ...invalid })).status, 400);
    }
    assert.equal((await request('/_admin/database/rows', { method: 'POST', headers: { ...headers, ...json }, body: '{"sql":"DROP TABLE example.lvl"}' })).status, 405);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM example.lvl')).rows[0].count, 2);
    // The inspector's read-only transaction must end before subsequent Bot writes.
    await pool.query('UPDATE example.lvl SET lvl = 6 WHERE user_id = $1', ['Alice']);
    page = await (await rows({ ...query, search: 'Alice' })).json();
    assert.equal(page.rows[0][3], 6);
    await database.db.query('UPDATE "odd""schema"."table""name" SET text_value = $1 WHERE "key""column" = 2', ['x'.repeat(5000)]);
    page = await (await rows({ ...unusual, search: '' })).json();
    assert.equal(page.truncated, true);
    assert.equal(page.rows[1][1].length, 4096);

    assert.equal((await request('/_admin/session', { method: 'DELETE', headers })).status, 403);
    assert.equal((await request('/_admin/session', { method: 'DELETE', headers: { ...headers, 'x-discord-mock-admin-csrf': session.csrf } })).status, 200);
    assert.equal((await request('/_admin/database/tables', { headers })).status, 403);
  } finally {
    await pool?.end();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
