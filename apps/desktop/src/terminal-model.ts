import { sameStyle, type TerminalSegment } from "./terminal-output.ts";

export type LogStream = "system" | "stdout" | "stderr";
export interface LogEntry {
  id: number;
  time: string;
  stream: LogStream;
  text: string;
  segments: TerminalSegment[];
}
export interface TerminalLine {
  id: number;
  revision: number;
  time: string;
  stream: LogStream;
  text: string;
  segments: TerminalSegment[];
}

/** チャンクを行へまとめる。出力元ごとの未完了行とCR更新を保持する。 */
export class TerminalModel {
  readonly lines: TerminalLine[] = [];
  private readonly pending = new Map<LogStream, TerminalLine>();
  private readonly carriageReturn = new Set<LogStream>();
  private lastEntry = 0;
  private sequence = 0;

  append(entry: LogEntry): void {
    if (entry.id <= this.lastEntry) return;
    this.lastEntry = entry.id;
    if (entry.stream === "system") {
      this.pending.clear();
      this.carriageReturn.clear();
    }
    for (const segment of entry.segments) {
      for (const character of segment.text) {
        let line = this.pending.get(entry.stream);
        if (character === "\r") {
          this.carriageReturn.add(entry.stream);
          continue;
        }
        if (character === "\n") {
          if (!line) this.create(entry);
          this.pending.delete(entry.stream);
          this.carriageReturn.delete(entry.stream);
          continue;
        }
        if (!line) line = this.create(entry);
        if (this.carriageReturn.delete(entry.stream)) {
          line.text = "";
          line.segments = [];
          line.revision++;
        }
        if (line.text.length >= 16384) continue;
        line.text += character;
        line.revision++;
        const last = line.segments.at(-1);
        if (last && sameStyle(last.style, segment.style))
          last.text += character;
        else if (line.segments.length < 512)
          line.segments.push({ text: character, style: { ...segment.style } });
        else if (last) last.text += character;
      }
    }
    if (entry.stream === "system") this.pending.delete("system");
  }

  private create(entry: LogEntry): TerminalLine {
    const line: TerminalLine = {
      id: ++this.sequence,
      revision: 0,
      time: entry.time,
      stream: entry.stream,
      text: "",
      segments: [],
    };
    this.lines.push(line);
    this.pending.set(entry.stream, line);
    while (this.lines.length > 1000) {
      const removed = this.lines.shift();
      if (removed && this.pending.get(removed.stream) === removed)
        this.pending.delete(removed.stream);
    }
    return line;
  }

  clear(): void {
    this.lines.length = 0;
    this.pending.clear();
    this.carriageReturn.clear();
  }
}
