export interface TerminalStyle {
  foreground?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
}
export interface TerminalSegment {
  text: string;
  style: TerminalStyle;
}
export interface TerminalText {
  text: string;
  segments: TerminalSegment[];
}

// SGRだけを表示に使う。OSC（リンク・クリップボードなど）とカーソル制御は実行しない。
const palette = [
  "#64748b",
  "#fb7185",
  "#6ee7b7",
  "#fcd34d",
  "#7da9ff",
  "#c4a1ff",
  "#67e8f9",
  "#e2e8f0",
  "#94a3b8",
  "#fda4af",
  "#a7f3d0",
  "#fde68a",
  "#a5c4ff",
  "#ddd6fe",
  "#a5f3fc",
  "#ffffff",
];
function color(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return;
  if (index < 16) return palette[index];
  if (index >= 232) {
    const shade = 8 + (index - 232) * 10;
    return `rgb(${shade}, ${shade}, ${shade})`;
  }
  const position = index - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  return `rgb(${steps[Math.floor(position / 36)]}, ${steps[Math.floor(position / 6) % 6]}, ${steps[position % 6]})`;
}
export function sameStyle(a: TerminalStyle, b: TerminalStyle): boolean {
  return (
    a.foreground === b.foreground &&
    a.background === b.background &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.inverse === b.inverse
  );
}

/** 分割されたUTF-8のデコード後に使う、ストリーム単位のANSIデコーダー。 */
export class AnsiDecoder {
  private state:
    | "text"
    | "escape"
    | "charset"
    | "csi"
    | "string"
    | "string-escape" = "text";
  private parameters = "";
  private style: TerminalStyle = {};

  write(input: string): TerminalText {
    const segments: TerminalSegment[] = [];
    let plain = "";
    const append = (text: string) => {
      if (!text) return;
      plain += text;
      const last = segments.at(-1);
      if (last && sameStyle(last.style, this.style)) last.text += text;
      else if (segments.length < 512)
        segments.push({ text, style: { ...this.style } });
      else if (last) last.text += text;
    };
    let text = "";
    for (const character of input) {
      if (this.state === "text") {
        if (
          character === "\x1b" ||
          character === "\x9b" ||
          character === "\x9d"
        ) {
          append(text);
          text = "";
          this.state =
            character === "\x9b"
              ? "csi"
              : character === "\x9d"
                ? "string"
                : "escape";
          this.parameters = "";
        } else if (
          (character >= " " && !(character >= "\x7f" && character <= "\x9f")) ||
          "\n\r\t".includes(character)
        )
          text += character;
      } else if (this.state === "escape") {
        this.parameters = "";
        this.state =
          character === "["
            ? "csi"
            : "]PX^_".includes(character)
              ? "string"
              : "()*+-./".includes(character)
                ? "charset"
                : "text";
      } else if (this.state === "charset") this.state = "text";
      else if (this.state === "csi") {
        if (character >= "@" && character <= "~") {
          if (character === "m" && /^[\d;:]*$/.test(this.parameters))
            this.sgr(this.parameters);
          this.state = "text";
        } else if (this.parameters.length < 128) this.parameters += character;
        else this.parameters = "invalid";
      } else if (this.state === "string") {
        if (character === "\x07" || character === "\x9c") this.state = "text";
        else if (character === "\x1b") this.state = "string-escape";
      } else
        this.state =
          character === "\\" || character === "\x07"
            ? "text"
            : character === "\x1b"
              ? "string-escape"
              : "string";
    }
    append(text);
    return { text: plain, segments };
  }

  private sgr(parameters: string): void {
    // ':' の拡張色も受理。RGB の空の色空間フィールドだけを省く。
    const values = parameters
      .replace(/:(2)::/g, ":$1:")
      .split(/[;:]/)
      .map((value) => (value === "" ? 0 : Number(value)));
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (value === 0) this.style = {};
      else if (value === 1) this.style.bold = true;
      else if (value === 2) this.style.dim = true;
      else if (value === 3) this.style.italic = true;
      else if (value === 4) this.style.underline = true;
      else if (value === 7) this.style.inverse = true;
      else if (value === 9) this.style.strike = true;
      else if (value === 22) {
        Reflect.deleteProperty(this.style, "bold");
        Reflect.deleteProperty(this.style, "dim");
      } else if (value === 23) Reflect.deleteProperty(this.style, "italic");
      else if (value === 24) Reflect.deleteProperty(this.style, "underline");
      else if (value === 27) Reflect.deleteProperty(this.style, "inverse");
      else if (value === 29) Reflect.deleteProperty(this.style, "strike");
      else if (value === 39) Reflect.deleteProperty(this.style, "foreground");
      else if (value === 49) Reflect.deleteProperty(this.style, "background");
      else if (value >= 30 && value <= 37)
        this.style.foreground = color(value - 30);
      else if (value >= 90 && value <= 97)
        this.style.foreground = color(value - 90 + 8);
      else if (value >= 40 && value <= 47)
        this.style.background = color(value - 40);
      else if (value >= 100 && value <= 107)
        this.style.background = color(value - 100 + 8);
      else if (value === 38 || value === 48) {
        const target = value === 38 ? "foreground" : "background";
        const mode = values[++index];
        if (mode === 5) this.style[target] = color(values[++index]);
        else if (mode === 2) {
          const rgb = values.slice(index + 1, index + 4);
          index += 3;
          if (
            rgb.length === 3 &&
            rgb.every(
              (value) => Number.isInteger(value) && value >= 0 && value <= 255,
            )
          )
            this.style[target] = `rgb(${rgb.join(", ")})`;
        }
      }
    }
  }
}
