import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("discordMockDesktop", {
  config: () => ipcRenderer.invoke("desktop:config"),
  discoveryDirectory: () => ipcRenderer.invoke("desktop:discovery-directory"),
  discover: () => ipcRenderer.invoke("desktop:discover"),
  saveConfig: (config: unknown) => ipcRenderer.invoke("desktop:save-config", config),
  start: () => ipcRenderer.invoke("desktop:start"),
  stop: () => ipcRenderer.invoke("desktop:stop"),
  restart: () => ipcRenderer.invoke("desktop:restart"),
  status: () => ipcRenderer.invoke("desktop:status"),
  windowSettings: () => ipcRenderer.invoke("desktop:window-settings"),
  saveWindowSettings: (value: unknown) => ipcRenderer.invoke("desktop:save-window-settings", value),
  moveWindow: (id: string, display: string) => ipcRenderer.invoke("desktop:move-window", id, display),
});
