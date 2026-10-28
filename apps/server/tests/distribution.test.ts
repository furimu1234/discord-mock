import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";

test("standalone CLI serves pages and compiled browser assets outside the workspace", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mock-bundle-"));
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown[]> | undefined;
  try {
    await copyFile(new URL("../dist/discord-mock.cjs", import.meta.url), join(directory, "discord-mock.cjs"));
    child = spawn(process.execPath, ["discord-mock.cjs", "--port", "0"], {
      cwd: directory,
      env: { ...process.env, DISCORD_MOCK_STATE_PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    exited = once(child, "exit");
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("CLI did not report its local URL")), 5000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("CLI exited before startup")); });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/Local: (http:\/\/127\.0\.0\.1:\d+)\/test/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });

    for (const path of ["/test", "/admin"]) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
      const html = await response.text();
      assert.match(html, /src="\/_ui\/client.js"/);
      assert.match(html, /grid-template-columns/);
    }
    const javascript = await fetch(`${url}/_ui/client.js`);
    assert.equal(javascript.status, 200);
    const source = await javascript.text();
    assert.match(source, /EventSource/);
    assert.doesNotThrow(() => new Script(source));
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    if (exited) await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
