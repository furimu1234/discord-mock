import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL("../", import.meta.url));
const environment = { ...process.env };
// VS Code のターミナルからも、Electron を Node 互換モードにせず起動する。
Reflect.deleteProperty(environment, "ELECTRON_RUN_AS_NODE");
const child = spawn(
  require("electron") as string,
  [directory, ...process.argv.slice(2)],
  {
    cwd: directory,
    env: environment,
    stdio: "inherit",
  },
);
const stop = () => {
  child.kill("SIGTERM");
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
child.once("error", (error) => {
  console.error(`Electron を実行できません: ${error.message}`);
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  for (const name of ["SIGINT", "SIGTERM"] as const)
    process.removeListener(name, stop);
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
