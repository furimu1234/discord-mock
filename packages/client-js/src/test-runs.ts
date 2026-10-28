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
>;
export interface TestRunProgress {
  status?: TestRunStatus;
  step?: string;
}
export interface TestRunSummary {
  id: string;
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
}
export interface TestRunPublication extends TestRunProgress {
  name: string;
  snapshot: MockSnapshot;
}
export interface TestRunTarget {
  baseUrl: string;
  name: string;
}
