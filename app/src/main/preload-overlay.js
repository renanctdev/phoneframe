const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  onInit: (cb) => ipcRenderer.on("overlay:init", (_e, p) => cb(p)),
  onCursor: (cb) => ipcRenderer.on("overlay:cursor", (_e, p) => cb(p)),
  onTap: (cb) => ipcRenderer.on("overlay:tap", (_e, p) => cb(p)),
});
