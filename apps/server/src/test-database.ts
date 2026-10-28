import type { DatabasePage, DatabaseQuery } from "./database.js";
import type { TestDatabaseSnapshot } from "../../../packages/client-js/src/test-runs.js";
import { ResourceError } from "./resource-validation.js";

function invalid(): never {
  throw new ResourceError("テストDBスナップショットが不正です");
}
function validName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
function cell(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 1024);
}

/** Discard unknown fields and reject malformed untrusted DB snapshots before storing them. */
export function sanitizeTestDatabase(value: unknown): TestDatabaseSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.tables) || source.tables.length > 32 || typeof source.truncated !== "boolean") invalid();
  const seen = new Set<string>();
  const tables: TestDatabaseSnapshot["tables"] = [];
  for (const raw of source.tables) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const table = raw as Record<string, unknown>;
    if (!validName(table.schema) || !validName(table.name) ||
        !Array.isArray(table.columns) || table.columns.length > 64 ||
        !Array.isArray(table.rows) || table.rows.length > 100 ||
        typeof table.totalRows !== "number" || !Number.isSafeInteger(table.totalRows) || table.totalRows < table.rows.length ||
        typeof table.truncated !== "boolean") invalid();
    const key = JSON.stringify([table.schema, table.name]);
    if (seen.has(key)) invalid();
    seen.add(key);
    const columns: TestDatabaseSnapshot["tables"][number]["columns"] = [];
    const columnNames = new Set<string>();
    for (const rawColumn of table.columns) {
      if (!rawColumn || typeof rawColumn !== "object" || Array.isArray(rawColumn)) invalid();
      const col = rawColumn as Record<string, unknown>;
      if (!validName(col.name) || typeof col.type !== "string" || col.type.length > 128 ||
          typeof col.nullable !== "boolean" || typeof col.primaryKey !== "boolean" ||
          columnNames.has(col.name)) invalid();
      columnNames.add(col.name);
      columns.push({ name: col.name, type: col.type, nullable: col.nullable, primaryKey: col.primaryKey });
    }
    const rows: TestDatabaseSnapshot["tables"][number]["rows"] = [];
    for (const rawRow of table.rows) {
      if (!Array.isArray(rawRow) || rawRow.length !== columns.length || !rawRow.every(cell)) invalid();
      rows.push(rawRow);
    }
    tables.push({
      schema: table.schema, name: table.name, columns, rows,
      totalRows: Number(table.totalRows), truncated: table.truncated,
    });
  }
  return { tables, truncated: source.truncated };
}

export function queryTestDatabase(database: TestDatabaseSnapshot, query: DatabaseQuery): DatabasePage | null {
  const table = database.tables.find((item) => item.schema === query.schema && item.name === query.table);
  if (!table) return null;
  if (query.sort && !table.columns.some((col) => col.name === query.sort)) return null;
  let rows = [...table.rows];
  if (query.search) {
    const search = query.search.toLocaleLowerCase();
    rows = rows.filter((row) => row.some((value) =>
      value !== null && String(value).toLocaleLowerCase().includes(search)));
  }
  if (query.sort) {
    const columnIndex = table.columns.findIndex((column) => column.name === query.sort);
    rows.sort((a, b) => {
      const x = a[columnIndex];
      const y = b[columnIndex];
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const result = typeof x === "number" && typeof y === "number"
        ? x - y : String(x).localeCompare(String(y));
      return query.direction === "desc" ? -result : result;
    });
  }
  const offset = rows.length ? Math.min(query.offset, Math.floor((rows.length - 1) / query.limit) * query.limit) : 0;
  return {
    schema: table.schema, table: table.name,
    columns: table.columns,
    rows: rows.slice(offset, offset + query.limit),
    totalRows: rows.length, // Only the captured rows are pageable; truncated explains omitted data.
    offset, limit: query.limit,
    truncated: table.truncated || database.truncated,
  };
}
