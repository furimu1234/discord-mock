import { contextBridge, ipcRenderer } from "electron";
import "./window-preload.ts";
contextBridge.exposeInMainWorld("discordMockTerminal", {
  history: () => ipcRenderer.invoke("terminal:history"),
  status: () => ipcRenderer.invoke("terminal:status"),
  copy: (text: string) => ipcRenderer.invoke("terminal:copy", text),
  onLog: (callback: (entry: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: unknown) => callback(entry);
    ipcRenderer.on("terminal:log", listener);
    return () => ipcRenderer.removeListener("terminal:log", listener);
  },
});
