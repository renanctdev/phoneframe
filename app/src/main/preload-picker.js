const { contextBridge, ipcRenderer } = require("electron");
const { DEVICES } = require("./deviceCatalog");

contextBridge.exposeInMainWorld("api", {
  devices: DEVICES,
  openSimulator: (deviceId, url, customWidth, customHeight) =>
    ipcRenderer.invoke("picker:open-simulator", { deviceId, url, customWidth, customHeight }),
  openRecording: () => ipcRenderer.invoke("picker:open-recording"),
});
