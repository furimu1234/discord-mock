#!/usr/bin/env node
import { startMock } from "./server.js";

function argsPort(argv: string[]): number {
  if (argv.length === 0) return 3000;
  if (argv.length !== 2 || argv[0] !== "--port" || !/^\d+$/.test(argv[1])) throw new Error("Usage: discord-mock [--port <0-65535>]");
  return Number(argv[1]);
}
try {
  const mock = await startMock({ port: argsPort(process.argv.slice(2)), statePath: process.env.DISCORD_MOCK_STATE_PATH });
  console.log(`Local: ${mock.url}/test (test) | ${mock.url}/admin (admin)`);
  console.log(`REST base: ${mock.url}/api | Gateway: ${mock.url.replace("http:", "ws:")}/gateway`);
  console.log(`Synthetic mock token: ${mock.token}`);
  console.log(`Test-only admin secret: ${mock.adminSecret}`);
  console.log("Voice/audio and full SDK compatibility are NOT implemented.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void mock.close(); });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
