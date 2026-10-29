import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dismock-nixos-launcher-"));
  const project = join(directory, "project with ' spaces");
  const bin = join(directory, "bin");
  await mkdir(join(project, "release/desktop"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(project, "shell.nix"), "{}\n");
  await copyFile(new URL("../../../run-nixos.sh", import.meta.url), join(project, "run-nixos.sh"));
  await writeFile(join(bin, "nix-shell"), [
    "#!/usr/bin/env bash",
    'printf "%s\\0" "$@" > "$DISMOCK_TEST_NIX_ARGS"',
    'while (($#)); do',
    '  if [[ $1 == --run ]]; then exec bash -c "$2"; fi',
    '  shift',
    'done',
    "exit 99",
  ].join("\n"), { mode: 0o755 });
  await writeFile(join(bin, "appimage-run"), [
    "#!/usr/bin/env bash",
    'printf "%s\\0" "$@" > "$DISMOCK_TEST_APP_ARGS"',
    'printf "%s" "${ELECTRON_RUN_AS_NODE-unset}" > "$DISMOCK_TEST_MODE"',
    'exit "${DISMOCK_TEST_EXIT:-0}"',
  ].join("\n"), { mode: 0o755 });
  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    ELECTRON_RUN_AS_NODE: "1",
    DISMOCK_TEST_NIX_ARGS: join(directory, "nix-args"),
    DISMOCK_TEST_APP_ARGS: join(directory, "app-args"),
    DISMOCK_TEST_MODE: join(directory, "mode"),
  };
  return {
    directory, project, environment,
    run(args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
      return spawnSync("bash", [join(project, "run-nixos.sh"), ...args], {
        cwd: directory, env: { ...environment, ...extra }, encoding: "utf8",
      });
    },
    async args(file: string) {
      return (await readFile(join(directory, file), "utf8")).split("\0").slice(0, -1);
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test("NixOS launcher finds the release from another cwd and passes the app exit code", async () => {
  const f = await fixture();
  try {
    const appimage = join(f.project, "release/desktop/discord-mock-1.0.0-linux-x86_64.AppImage");
    await writeFile(appimage, "fixture");
    const result = f.run([], { DISMOCK_TEST_EXIT: "23" });
    assert.equal(result.status, 23, result.stderr);
    assert.deepEqual((await f.args("nix-args")).slice(0, 5), [join(f.project, "shell.nix"), "--arg", "desktop", "true", "--run"]);
    assert.deepEqual(await f.args("app-args"), [appimage]);
    assert.equal(await readFile(join(f.directory, "mode"), "utf8"), "unset");
  } finally { await f.close(); }
});

test("NixOS launcher treats paths and app arguments as literal text", async () => {
  const f = await fixture();
  try {
    const relative = "app with ' quotes $(touch INJECTED).AppImage";
    const appimage = join(f.directory, relative);
    await writeFile(appimage, "fixture");
    const args = ["--user-data-dir=profile with spaces", "$(touch INJECTED)", "line\nbreak"];
    const result = f.run([relative, ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await f.args("app-args"), [appimage, ...args]);
    await assert.rejects(readFile(join(f.directory, "INJECTED")), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("NixOS launcher requires an unambiguous AppImage and never builds automatically", async () => {
  const f = await fixture();
  try {
    let result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pnpm build:linux/);
    await assert.rejects(readFile(join(f.directory, "nix-args")), { code: "ENOENT" });
    for (const version of ["1.0.0", "2.0.0"])
      await writeFile(join(f.project, `release/desktop/discord-mock-${version}-linux-x86_64.AppImage`), "fixture");
    result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /複数/);
    await assert.rejects(readFile(join(f.directory, "nix-args")), { code: "ENOENT" });
    assert.equal(f.run(["--help"]).status, 0);
  } finally { await f.close(); }
});
