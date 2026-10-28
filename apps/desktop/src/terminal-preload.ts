import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("discordMockTerminal", {
  history: () => ipcRenderer.invoke("terminal:history"),
  onLog: (callback: (entry: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: unknown) => callback(entry);
    ipcRenderer.on("terminal:log", listener);
    return () => ipcRenderer.removeListener("terminal:log", listener);
  },
});
