/** Only the local app can supply test cases. No arbitrary command or file paths from HTTP. */
export interface TestCaseInfo {
  id: string;
  name: string;
}

export interface TestCaseService {
  list(): Promise<TestCaseInfo[]>;
  start(id: string): Promise<void>;
  status(): { runningId: string | null; error: string | null };
  close(): Promise<void>;
}
