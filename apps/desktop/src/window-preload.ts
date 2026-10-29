import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("discordMockWindow", {
  action: (action: "minimize" | "maximize" | "close"): Promise<void> =>
    ipcRenderer.invoke("window:action", action),
  resize: (phase: "start" | "move" | "end", payload?: unknown): void => {
    ipcRenderer.send("window:resize", phase, payload);
  },
});
