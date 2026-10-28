export {};
interface Entry { time: string; stream: "system" | "stdout" | "stderr"; text: string; }
interface TerminalBridge { history(): Promise<Entry[]>; onLog(callback: (entry: Entry) => void): () => void; }
declare global { interface Window { discordMockTerminal?: TerminalBridge; } }
const output = document.getElementById("output");
if (output && window.discordMockTerminal) {
  const queue: HTMLElement[] = [];
  const append = (entry: Entry) => {
    const row = document.createElement("div");
    row.className = `log-${entry.stream}`;
    row.textContent = `[${new Date(entry.time).toLocaleTimeString()}] [${entry.stream}] ${entry.text}`;
    output.append(row);
    queue.push(row);
    while (queue.length > 1000) queue.shift()?.remove();
    output.scrollTop = output.scrollHeight;
  };
  window.discordMockTerminal.onLog(append);
  void window.discordMockTerminal.history().then((entries) => {
    output.replaceChildren();
    queue.length = 0;
    for (const entry of entries) append(entry);
  });
}
