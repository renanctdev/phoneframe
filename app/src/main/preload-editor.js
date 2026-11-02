const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("editorApi", {
  load: () => ipcRenderer.invoke("editor:load"),
  save: (project) => ipcRenderer.invoke("editor:save", project),
  fileSize: (name) => ipcRenderer.invoke("editor:file-size", name),
  fileRead: (name, start, end) => ipcRenderer.invoke("editor:file-read", name, start, end),
  fileWrite: (name, position, data) => ipcRenderer.invoke("editor:file-write", name, position, data),
  fileFinish: (name, ok) => ipcRenderer.invoke("editor:file-finish", name, ok),
  saveBackground: (ext, data) => ipcRenderer.invoke("editor:save-background", ext, data),
  openFolder: () => ipcRenderer.invoke("editor:open-folder"),
  exportChoose: (defaultName) => ipcRenderer.invoke("export:choose", defaultName),
  exportWrite: (id, position, data) => ipcRenderer.invoke("export:write", id, position, data),
  exportClose: (id, ok) => ipcRenderer.invoke("export:close", id, ok),
  exportReveal: (file) => ipcRenderer.invoke("export:reveal", file),
  about: () => ipcRenderer.invoke("app:about"),
  openLink: (kind) => ipcRenderer.invoke("app:open-link", kind),
});
