import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  closeWindow: () => ipcRenderer.send("window-close"),
  onServerStatus: (callback: (status: "starting" | "ready" | "crashed") => void) => {
    ipcRenderer.on("server-status", (_event, status) => callback(status));
  },
});
