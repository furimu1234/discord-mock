import assert from "node:assert/strict";

export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== undefined && value !== null, "テストの前提値が必要です");
  return value;
}
