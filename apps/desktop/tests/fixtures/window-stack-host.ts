import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const file = process.argv[2];
const mode = process.argv[3];
const ready = setTimeout(() => process.stdout.write('{"ready":true}\n'), mode === "delayed" ? 100 : 0);
const lines = createInterface({ input: process.stdin });
lines.on("line", line => {
  appendFileSync(file, `${line}\n`);
  if (mode === "exit") { process.exit(2); return; }
  const request = JSON.parse(line) as { id: number };
  const status = mode === "skipped" ? "skipped" : mode === "error" ? "error" : "placed";
  process.stdout.write(`${JSON.stringify({ id: request.id, status })}\n`);
});
lines.on("close", () => clearTimeout(ready));
