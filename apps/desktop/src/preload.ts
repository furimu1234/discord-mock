import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("discordMockDesktop", {
  config: () => ipcRenderer.invoke("desktop:config"),
  saveConfig: (config: unknown) => ipcRenderer.invoke("desktop:save-config", config),
  start: () => ipcRenderer.invoke("desktop:start"),
  stop: () => ipcRenderer.invoke("desktop:stop"),
  restart: () => ipcRenderer.invoke("desktop:restart"),
  status: () => ipcRenderer.invoke("desktop:status"),
});
