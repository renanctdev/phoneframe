const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rec", {
  prepare: () => ipcRenderer.invoke("rec:prepare"),
  started: () => ipcRenderer.send("rec:started"),
  stopping: () => ipcRenderer.send("rec:stopping"),
  chunk: (position, data) => ipcRenderer.invoke("rec:chunk", position, data),
  finished: (info) => ipcRenderer.invoke("rec:finished", info),
  failed: (message) => ipcRenderer.send("rec:failed", String(message)),
  openFolder: () => ipcRenderer.send("rec:open-folder"),
  onCommand: (cb) => ipcRenderer.on("rec:command", (_e, cmd) => cb(cmd)),
  onState: (cb) => ipcRenderer.on("rec:state", (_e, s) => cb(s)),
});
