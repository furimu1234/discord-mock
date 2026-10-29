import assert from "node:assert/strict";
import { test } from "node:test";
import { AnsiDecoder } from "../src/terminal-output.ts";
import { TerminalModel, type LogEntry } from "../src/terminal-model.ts";

test("分割されたANSI色・太字を保持し、リセットと出力元の分離を守る", () => {
  const decoder = new AnsiDecoder();
  assert.equal(decoder.write("\x1b[3").text, "");
  const colored = decoder.write("2;1m成功");
  assert.deepEqual(colored.segments, [
    { text: "成功", style: { foreground: "#6ee7b7", bold: true } },
  ]);
  assert.equal(decoder.write(" 継続").segments[0].style.foreground, "#6ee7b7");
  assert.deepEqual(decoder.write("\x1b[22;39m通常").segments, [
    { text: "通常", style: {} },
  ]);
  assert.deepEqual(new AnsiDecoder().write("別出力").segments[0].style, {});
  assert.equal(
    colored.segments[0].style.bold,
    true,
    "過去の出力のstyleを変更しない",
  );
});

test("16色・256色・RGBと背景色を描画可能な値だけに変換する", () => {
  const decoder = new AnsiDecoder();
  const value = decoder.write(
    "\x1b[91;48;5;17mA\x1b[38;2;10;120;230;3;4mB\x1b[0mC\x1b[38:2::20:30:40mD",
  );
  assert.equal(value.text, "ABCD");
  assert.equal(value.segments[0].style.foreground, "#fda4af");
  assert.equal(value.segments[0].style.background, "rgb(0, 0, 95)");
  assert.equal(value.segments[1].style.foreground, "rgb(10, 120, 230)");
  assert.equal(value.segments[1].style.italic, true);
  assert.equal(value.segments[1].style.underline, true);
  assert.deepEqual(value.segments[2].style, {});
  assert.equal(value.segments[3].style.foreground, "rgb(20, 30, 40)");
  assert.equal(
    decoder.write("\x1b[38;2;999;0;0mX").segments[0].style.foreground,
    "rgb(20, 30, 40)",
  );
});

test("OSCリンク・クリップボード・画面制御を無視し、HTMLは文字列のまま保持する", () => {
  const decoder = new AnsiDecoder();
  assert.equal(decoder.write("\x1b]52;c;secret").text, "");
  const text = decoder.write(
    "\x07\x1b]8;;https://example.invalid\x1b\\<img src=x onerror=alert(1)>\x1b]8;;\x1b\\\x1b[2J\x07",
  );
  assert.equal(text.text, "<img src=x onerror=alert(1)>");
  assert.equal(text.segments[0].text, text.text);
  assert.equal(JSON.stringify(text).includes("secret"), false);
  assert.equal(decoder.write(`\x1b[${"1;".repeat(300)}m表示`).text, "表示");
});

function entry(
  id: number,
  text: string,
  stream: LogEntry["stream"] = "stdout",
): LogEntry {
  return {
    id,
    stream,
    time: "2026-10-29T00:00:00.000Z",
    ...new AnsiDecoder().write(text),
  };
}
test("部分行・CRLF・進捗のCR更新を処理し、履歴とライブ通知の重複を除く", () => {
  const model = new TerminalModel();
  model.append(entry(1, "日本"));
  model.append(entry(2, "語\r"));
  model.append(entry(3, "\n10%"));
  model.append(entry(3, "重複"));
  model.append(entry(4, "\r100%\n"));
  assert.deepEqual(
    model.lines.map((line) => line.text),
    ["日本語", "100%"],
  );
  model.append(entry(5, "stdout途中"));
  model.append(entry(6, "stderr\n", "stderr"));
  model.append(entry(7, "続き\n"));
  assert.deepEqual(
    model.lines.slice(2).map((line) => line.text),
    ["stdout途中続き", "stderr"],
  );
  model.clear();
  model.append(entry(7, "過去通知"));
  model.append(entry(8, "新しいログ"));
  assert.deepEqual(
    model.lines.map((line) => line.text),
    ["新しいログ"],
  );
});

test("大量出力の行数・1行の長さ・装飾数を制限する", () => {
  const model = new TerminalModel();
  model.append(entry(1, "a\n".repeat(1100)));
  assert.equal(model.lines.length, 1000);
  model.append(entry(2, "x".repeat(100_000)));
  assert.equal(model.lines.length, 1000);
  assert.equal(model.lines.at(-1)?.text.length, 16384);
  const decoded = new AnsiDecoder().write("\x1b[31mA\x1b[32mB".repeat(2000));
  assert.equal(decoded.segments.length <= 512, true);
  assert.equal(
    decoded.segments.map((segment) => segment.text).join(""),
    decoded.text,
  );
});
