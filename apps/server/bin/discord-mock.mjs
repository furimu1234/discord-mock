#!/usr/bin/env node
import { listenLocal } from "../src/server.mjs";

function parsePort(argv) {
  const idx = argv.indexOf("--port");
  if (idx === -1) {
    if (argv.length !== 0) throw new Error("Usage: discord-mock [--port <0-65535>]");
    return 3000;
  }
  if (argv.length !== 2 || idx !== 0 || !/^\d+$/.test(argv[1])) {
    throw new Error("Usage: discord-mock [--port <0-65535>]");
  }
  return Number(argv[1]);
}

try {
  const { server, url } = await listenLocal({ port: parsePort(process.argv.slice(2)) });
  console.log(`discord-mock preview: ${url}`);
  console.log(`Test: ${url}/test | Admin: ${url}/admin`);
  console.log("REST/Gateway/Voice compatibility is not implemented yet.");
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close());
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
