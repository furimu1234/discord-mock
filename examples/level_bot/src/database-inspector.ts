import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { TestDatabaseSnapshot } from "../../../packages/client-js/src/test-runs.js";
import type { DatabaseColumn, DatabaseInspector, DatabasePage, DatabaseQuery, DatabaseValue } from "../../../apps/server/src/database.js";

const USER_TABLES = `
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
`;

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

interface ValueBudget {
  remaining: number;
  truncated: boolean;
}

function cellValue(value: unknown, budget: ValueBudget): DatabaseValue {
  if (value == null) return null;
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "bigint" || typeof value === "number") text = String(value);
  else if (value instanceof Date) text = value.toISOString();
  else if (value instanceof Uint8Array) text = `\\x${Buffer.from(value).toString("hex")}`;
  else text = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? String(item) : item) ?? "";
  const length = Math.min(4096, budget.remaining);
  budget.remaining -= Math.min(text.length, length);
  if (text.length <= length) return text;
  budget.truncated = true;
  return `${text.slice(0, Math.max(0, length - 1))}…`;
}

async function readOnly<T>(database: PGlite, read: (transaction: Transaction) => Promise<T>): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.exec("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '3000ms'");
    return read(transaction);
  });
}

/** Introspect this app's own PGlite instance. Never accepts SQL or a connection URL. */
export function createDatabaseInspector(database: PGlite): DatabaseInspector {
  return {
    async tables() {
      return readOnly(database, async (transaction) => {
        const result = await transaction.query<{ schema: string; name: string; column_count: number }>(`
          SELECT n.nspname AS schema, c.relname AS name,
            (SELECT count(*)::integer FROM pg_catalog.pg_attribute AS a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS column_count
          ${USER_TABLES}
          ORDER BY n.nspname, c.relname
        `);
        return result.rows.map((table) => ({ schema: table.schema, name: table.name, columnCount: table.column_count }));
      });
    },
    async rows(query: DatabaseQuery): Promise<DatabasePage | null> {
      return readOnly(database, async (transaction) => {
        const relation = await transaction.query<{ oid: number }>(`
          SELECT c.oid ${USER_TABLES} AND n.nspname = $1 AND c.relname = $2
        `, [query.schema, query.table]);
        if (!relation.rows.length) return null;
        const metadata = await transaction.query<{ name: string; type: string; nullable: boolean; primary_key: boolean }>(`
          SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable,
            EXISTS (SELECT 1 FROM pg_catalog.pg_index AS i
                    WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS primary_key
          FROM pg_catalog.pg_attribute AS a
          WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum
        `, [relation.rows[0].oid]);
        const columns: DatabaseColumn[] = metadata.rows.map((column) => ({
          name: column.name, type: column.type, nullable: column.nullable, primaryKey: column.primary_key,
        }));
        if (query.sort && !columns.some((column) => column.name === query.sort)) return null;

        const tableName = `${identifier(query.schema)}.${identifier(query.table)}`;
        const values: unknown[] = [];
        let filter = "";
        if (query.search) {
          values.push(`%${query.search.replace(/[\\%_]/g, "\\$&")}%`);
          filter = "WHERE to_jsonb(t)::text ILIKE $1";
        }
        const count = await transaction.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${tableName} AS t ${filter}`, values);
        const totalRows = Number(count.rows[0].count);
        if (!Number.isSafeInteger(totalRows)) throw new Error("Record count is too large");
        const offset = totalRows ? Math.min(query.offset, Math.floor((totalRows - 1) / query.limit) * query.limit) : 0;
        const sort = query.sort
          ? [`t.${identifier(query.sort)} ${query.direction === "desc" ? "DESC" : "ASC"}`]
          : columns.filter((column) => column.primaryKey).map((column) => `t.${identifier(column.name)} ASC`);
        sort.push("t.tableoid", "t.ctid");
        values.push(query.limit, offset);
        const result = await transaction.query<unknown[]>(`
          SELECT t.* FROM ${tableName} AS t ${filter}
          ORDER BY ${sort.join(", ")}
          LIMIT $${values.length - 1} OFFSET $${values.length}
        `, values, { rowMode: "array" });
        const budget: ValueBudget = { remaining: 256 * 1024, truncated: false };
        const rows = result.rows.map((row) => row.map((value) => cellValue(value, budget)));
        return { schema: query.schema, table: query.table, columns, rows, totalRows, offset, limit: query.limit, truncated: budget.truncated };
      });
    },
  };
}

/**
 * Read-only snapshot of the actual isolated test PGlite.
 * This captures any user-defined table, not only example.lvl. The browser never accesses its DSN.
 */
export async function captureTestDatabase(database: PGlite): Promise<TestDatabaseSnapshot> {
  const inspector = createDatabaseInspector(database);
  const allTables = await inspector.tables();
  const snapshot: TestDatabaseSnapshot = { tables: [], truncated: allTables.length > 32 };
  let budget = 32 * 1024;
  for (const table of allTables.slice(0, 32)) {
    const page = await inspector.rows({
      schema: table.schema, table: table.name, offset: 0, limit: 100,
      search: "", sort: "", direction: "asc",
    });
    if (!page) continue;
    const item: TestDatabaseSnapshot["tables"][number] = {
      schema: table.schema, name: table.name,
      columns: page.columns, rows: [],
      totalRows: page.totalRows, truncated: page.totalRows > page.rows.length || page.truncated,
    };
    const overhead = Buffer.byteLength(JSON.stringify({ ...item, rows: [] }), "utf8");
    if (overhead > budget) { snapshot.truncated = true; break; }
    budget -= overhead;
    for (const row of page.rows) {
      const safe = row.map((value) => {
        if (typeof value !== "string") return value;
        if (value.length > 1024) item.truncated = true;
        return value.slice(0, 1024);
      });
      const bytes = Buffer.byteLength(JSON.stringify(safe), "utf8") + 2;
      if (bytes > budget) { item.truncated = true; snapshot.truncated = true; break; }
      budget -= bytes;
      item.rows.push(safe);
    }
    snapshot.tables.push(item);
    if (budget < 2000) { snapshot.truncated = true; break; }
  }
  return snapshot;
}
