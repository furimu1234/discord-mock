import type {
  MockChannel,
  MockMessage,
  MockSnapshot,
} from "./testing-types.js";

export type TestRunStatus = "running" | "passed" | "failed" | "cancelled";
export type TestRunMessage = Pick<
  MockMessage,
  | "id"
  | "channel_id"
  | "content"
  | "author"
  | "timestamp"
  | "embeds"
  | "interaction"
> & { edited_timestamp?: string | null; canEdit?: boolean; canDelete?: boolean };
export interface TestDatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

/** Live test DB contents captured from the real isolated PGlite database (bounded, read-only copy). */
export interface TestDatabaseSnapshot {
  tables: Array<{
    schema: string;
    name: string;
    columns: TestDatabaseColumn[];
    rows: Array<Array<string | number | boolean | null>>;
    totalRows: number;
    truncated: boolean;
  }>;
  truncated: boolean;
}

export interface TestRunProgress {
  status?: TestRunStatus;
  step?: string;
  database?: TestDatabaseSnapshot;
}
export interface TestRunSummary {
  id: string;
  hasDatabase?: boolean;
  name: string;
  status: TestRunStatus;
  step: string;
  startedAt: string;
  updatedAt: string;
}
export interface TestRunView extends TestRunSummary {
  steps: { text: string; timestamp: string }[];
  guild: {
    name: string;
    channels: Pick<MockChannel, "id" | "name" | "type">[];
  };
  messages: Record<string, TestRunMessage[]>;
  database?: TestDatabaseSnapshot;
}
export interface TestRunPublication extends TestRunProgress {
  name: string;
  snapshot: MockSnapshot;
}
export interface TestRunTarget {
  baseUrl: string;
  name: string;
}
