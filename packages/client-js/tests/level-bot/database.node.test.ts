import { required } from "./required.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as pause } from "node:timers/promises";
import { startLevelBot } from "../../../../examples/level_bot/packages/bot/src/testClient.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { startApp } from "./built-app.js";
import type {
  DatabasePage,
  DatabaseTable,
} from "../../../../apps/server/src/database.js";

test(
  "DB explorer reads the live PGlite records with separate admin auth and bounded safe queries",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mock-db-"));
    let app: Awaited<ReturnType<typeof startApp>> | undefined;
    let pool: pg.Pool | undefined;
    try {
      app = await startApp({ port: 0, dataDir: directory });
      const { mock, database } = app;
      const request = (path: string, options?: RequestInit) =>
        fetch(`${mock.url}${path}`, options);
      const dummyResponse = await request("/_ui/session");
      const dummy = await dummyResponse.json();
      const dummyCookie = required(
        dummyResponse.headers.get("set-cookie"),
      ).split(";")[0];
      assert.equal((await request("/database")).status, 200);
      assert.deepEqual(await (await request("/_admin/session")).json(), {
        authenticated: false,
        databaseAvailable: true,
      });
      for (const headers of [
        {},
        { cookie: dummyCookie, "x-discord-mock-csrf": dummy.csrf },
        { authorization: `Bot ${mock.token}` },
      ] as Record<string, string>[]) {
        assert.equal(
          (await request("/_admin/database/tables", { headers })).status,
          403,
        );
      }
      const json = { "content-type": "application/json" };
      assert.equal(
        (
          await request("/_admin/session", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ secret: mock.token }),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/_admin/session", {
            method: "POST",
            headers: { ...json, origin: "http://localhost:5555" },
            body: JSON.stringify({ secret: mock.adminSecret }),
          })
        ).status,
        403,
      );
      const login = await request("/_admin/session", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ secret: mock.adminSecret }),
      });
      assert.equal(login.status, 200);
      assert.match(
        required(login.headers.get("set-cookie")),
        /HttpOnly; SameSite=Strict; Path=\/_admin; Max-Age=3600/,
      );
      const session = await login.json();
      const headers = {
        cookie: required(login.headers.get("set-cookie")).split(";")[0],
      };

      // Write using the same PostgreSQL wire endpoint used by the Bot's pg/Drizzle code.
      pool = new pg.Pool({ connectionString: database.dsn, max: 1 });
      await pool.query(
        "INSERT INTO example.lvl (server_id, user_id, lvl) VALUES ($1, $2, $3), ($1, $4, $5)",
        ["guild", "Alice", 5, "Bob", 2],
      );
      await database.db.exec(
        'CREATE SCHEMA "odd""schema"; CREATE TABLE "odd""schema"."table""name" ("key""column" integer PRIMARY KEY, text_value text, payload jsonb, missing text);',
      );
      await database.db.query(
        'INSERT INTO "odd""schema"."table""name" VALUES ($1, $2, $3, NULL), ($4, $5, $6, NULL)',
        [1, "100%_literal", { test: "<script>" }, 2, "other", {}],
      );
      const tables = (await (
        await request("/_admin/database/tables", { headers })
      ).json()) as { tables: DatabaseTable[] };
      assert.ok(
        tables.tables.some(
          (table) =>
            table.schema === "example" &&
            table.name === "lvl" &&
            table.columnCount === 4,
        ),
      );
      assert.equal(
        tables.tables.some(
          (table) =>
            table.schema.startsWith("pg_") ||
            table.schema === "information_schema",
        ),
        false,
      );
      const rows = async (parameters: Record<string, string>) =>
        request(`/_admin/database/rows?${new URLSearchParams(parameters)}`, {
          headers,
        });
      const query = {
        schema: "example",
        table: "lvl",
        sort: "lvl",
        direction: "desc",
        limit: "1",
      };
      let page = (await (await rows(query)).json()) as DatabasePage;
      assert.equal(page.totalRows, 2);
      assert.deepEqual(
        page.columns.map((column) => column.name),
        ["id", "server_id", "user_id", "lvl"],
      );
      assert.equal(page.columns[0].primaryKey, true);
      assert.equal(page.columns[0].nullable, false);
      assert.equal(page.rows[0][2], "Alice");
      page = await (await rows({ ...query, offset: "1" })).json();
      assert.equal(page.rows[0][2], "Bob");
      page = await (await rows({ ...query, search: "alice" })).json();
      assert.equal(page.totalRows, 1);
      assert.equal(page.rows[0][3], 5);
      const unusual = {
        schema: 'odd"schema',
        table: 'table"name',
        sort: 'key"column',
        search: "%_",
      };
      page = await (await rows(unusual)).json();
      assert.equal(page.totalRows, 1, "wildcards are searched literally");
      assert.deepEqual(page.rows, [
        [1, "100%_literal", '{"test":"<script>"}', null],
      ]);
      assert.equal(
        (
          await rows({
            ...unusual,
            search: "' OR true; DROP TABLE example.lvl; --",
          })
        ).status,
        200,
      );
      assert.equal(
        (await rows({ ...query, table: "lvl; DROP TABLE example.lvl; --" }))
          .status,
        404,
      );
      assert.equal(
        (await rows({ ...query, sort: "lvl; DROP TABLE example.lvl; --" }))
          .status,
        404,
      );
      for (const invalid of [
        { limit: "101" },
        { offset: "-1" },
        { search: "x".repeat(201) },
        { direction: "asc; DROP TABLE example.lvl" },
      ] as Record<string, string>[]) {
        assert.equal((await rows({ ...query, ...invalid })).status, 400);
      }
      assert.equal(
        (
          await request("/_admin/database/rows", {
            method: "POST",
            headers: { ...headers, ...json },
            body: '{"sql":"DROP TABLE example.lvl"}',
          })
        ).status,
        405,
      );
      assert.equal(
        (await pool.query("SELECT count(*)::integer AS count FROM example.lvl"))
          .rows[0].count,
        2,
      );
      // The inspector's read-only transaction must end before subsequent Bot writes.
      await pool.query("UPDATE example.lvl SET lvl = 6 WHERE user_id = $1", [
        "Alice",
      ]);
      page = await (await rows({ ...query, search: "Alice" })).json();
      assert.equal(page.rows[0][3], 6);
      await database.db.query(
        'UPDATE "odd""schema"."table""name" SET text_value = $1 WHERE "key""column" = 2',
        ["x".repeat(5000)],
      );
      page = await (await rows({ ...unusual, search: "" })).json();
      assert.equal(page.truncated, true);
      assert.equal(String(page.rows[1][1]).length, 4096);

      assert.equal(
        (await request("/_admin/session", { method: "DELETE", headers }))
          .status,
        403,
      );
      assert.equal(
        (
          await request("/_admin/session", {
            method: "DELETE",
            headers: { ...headers, "x-discord-mock-admin-csrf": session.csrf },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/_admin/database/tables", { headers })).status,
        403,
      );
    } finally {
      await pool?.end();
      await app?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("任意のテーブルに書いたPGliteレコードをテスト終了後用に取得できる", async () => {
  const { startEphemeralDatabase } = await import("./built-app.js");
  const { captureTestDatabase } = await import("dismock/runtime");
  const database = await startEphemeralDatabase();
  try {
    await database.db.query(
      "INSERT INTO example.lvl (server_id, user_id, lvl) VALUES ($1,$2,$3)",
      ["123456789000000003", "123456789000000099", 2],
    );
    await database.db.exec(
      "CREATE SCHEMA extra; CREATE TABLE extra.custom_feature(id integer, value text);",
    );
    await database.db.query(
      "INSERT INTO extra.custom_feature VALUES ($1, $2)",
      [1, "hello from bot"],
    );
    const captured = await captureTestDatabase(database.db);
    const levels = captured.tables.find(
      (t) => t.schema === "example" && t.name === "lvl",
    );
    assert.ok(levels);
    assert.ok(
      levels.rows.some(
        (row) => row[2] === "123456789000000099" && row[3] === 2,
      ),
    );
    const custom = captured.tables.find(
      (t) => t.schema === "extra" && t.name === "custom_feature",
    );
    assert.ok(custom);
    assert.deepEqual(custom.rows, [[1, "hello from bot"]]);
  } finally {
    await database.close();
  }
});

test(
  "複数の独立したBot UTがAppの同じPGliteを利用し、実際の投稿でレベルを累積する",
  {
    timeout: 30_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mock-shared-db-"));
    const { startMock } = createRequire(import.meta.url)(
      "../../../../apps/server/dist/server.cjs",
    ) as typeof import("../../../../apps/server/src/server.js");
    const app = await startApp({ port: 0, dataDir: directory });
    const pool = new pg.Pool({ connectionString: app.database.dsn, max: 1 });
    try {
      for (const expected of [2, 3]) {
        const mock = await startMock({ port: 0 });
        let bot: Awaited<ReturnType<typeof startLevelBot>> | undefined;
        try {
          bot = await startLevelBot(mock.url, mock.token, app.database.dsn);
          const user = mock.testing.users.findByName("Alice");
          const channel = mock.testing.channels.findByName("general");
          assert.ok(user);
          assert.ok(channel);
          await mock.testing
            .as(user)
            .sendMessage(channel.id, `共有DBのレベル検証${expected}`);
          let current: number | undefined;
          const deadline = Date.now() + 6000;
          while (Date.now() < deadline) {
            const result = await pool.query<{ lvl: number }>(
              "SELECT lvl FROM example.lvl WHERE server_id = $1 AND user_id = $2",
              [mock.testing.guild.id, user.id],
            );
            current = result.rows[0]?.lvl;
            if (current === expected) break;
            await pause(50);
          }
          assert.equal(
            current,
            expected,
            "独立したBot再起動後もレベルは同一DBに蓄積される",
          );
        } finally {
          await bot?.close();
          await mock.close();
        }
      }

      // WebのDB ExplorerとBotから見たレコードは同じ。
      const login = await fetch(`${app.mock.url}/_admin/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-mock-local": "1",
        },
        body: "{}",
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const result = await fetch(
        `${app.mock.url}/_admin/database/rows?schema=example&table=lvl`,
        {
          headers: { cookie },
        },
      );
      assert.equal(result.status, 200);
      const data = (await result.json()) as DatabasePage;
      assert.equal(data.totalRows, 1);
      assert.equal(data.rows[0][3], 3);
    } finally {
      await pool.end();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
