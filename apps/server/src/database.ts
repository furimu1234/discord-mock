/** Read-only provider contract. The standalone Mock has no database dependency. */
export interface DatabaseTable {
  schema: string;
  name: string;
  columnCount: number;
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export type DatabaseValue = string | number | boolean | null;

export interface DatabaseQuery {
  schema: string;
  table: string;
  offset: number;
  limit: number;
  search: string;
  sort: string;
  direction: "asc" | "desc";
}

export interface DatabasePage {
  schema: string;
  table: string;
  columns: DatabaseColumn[];
  rows: DatabaseValue[][];
  totalRows: number;
  offset: number;
  limit: number;
  truncated: boolean;
}

export interface DatabaseInspector {
  tables(): Promise<DatabaseTable[]>;
  rows(query: DatabaseQuery): Promise<DatabasePage | null>;
}
