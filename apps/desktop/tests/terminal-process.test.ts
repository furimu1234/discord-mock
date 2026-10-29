import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { BotProcess } from "../src/bot-process.ts";

test("実プロセスの分割UTF-8とANSIを保持し、コピー用の本文には制御文字を残さない", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dismock-terminal-"));
  const bot = new BotProcess(
    join(directory, "config.json"),
    () => ({ FORCE_COLOR: "2" }),
    () => {},
    directory,
  );
  try {
    await bot.save({
      command: process.execPath,
      cwd: directory,
      args: [
        "--input-type=module",
        "-e",
        `
      import {setTimeout} from 'node:timers/promises';
      process.stdout.write('FORCE_COLOR='+process.env.FORCE_COLOR+'\\n');
      process.stdout.write('\\x1b[3');
      await setTimeout(20);
      process.stdout.write('2m');
      const text = Buffer.from('日本語');
      process.stdout.write(text.subarray(0,1));
      await setTimeout(20);
      process.stdout.write(text.subarray(1));
      process.stdout.write('\\x1b[0m\\n');
      process.stderr.write('\\x1b[31m失敗\\x1b[0m\\n');
    `,
      ],
    });
    await bot.start();
    for (let attempt = 0; attempt < 200; attempt++) {
      if (
        bot
          .logs()
          .some(
            (entry) =>
              entry.stream === "system" && entry.text.includes("Bot 終了"),
          )
      )
        break;
      await delay(20);
    }
    assert.equal(bot.status().running, false);
    const stdout = bot.logs().filter((entry) => entry.stream === "stdout");
    assert.equal(
      stdout.map((entry) => entry.text).join(""),
      "FORCE_COLOR=2\n日本語\n",
    );
    assert.equal(
      stdout.some((entry) =>
        entry.segments.some(
          (segment) => segment.style.foreground === "#6ee7b7",
        ),
      ),
      true,
    );
    assert.equal(
      bot
        .logs()
        .filter((entry) => entry.stream === "stderr")
        .some((entry) =>
          entry.segments.some(
            (segment) => segment.style.foreground === "#fb7185",
          ),
        ),
      true,
    );
    assert.equal(
      bot
        .logs()
        .some(
          (entry) =>
            entry.text.includes("\u001b") || entry.text.includes("\ufffd"),
        ),
      false,
    );
  } finally {
    await bot.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
