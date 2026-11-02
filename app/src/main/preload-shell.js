const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

// Script que desenha o menu dos <select> dentro do site (ver guest-select-popup.js).
let guestSelectScript = "";
try {
  guestSelectScript = fs.readFileSync(path.join(__dirname, "guest-select-popup.js"), "utf8");
} catch (err) {
  console.error("guest-select-popup.js não encontrado", err);
}

contextBridge.exposeInMainWorld("api", {
  onInit: (callback) => ipcRenderer.on("shell:init", (_event, payload) => callback(payload)),
  normalizeUrl: (url) => ipcRenderer.invoke("shell:normalize-url", url),
  changeDevice: () => ipcRenderer.send("shell:change-device"),
  quit: () => ipcRenderer.send("shell:quit"),
  guestSelectScript,
});
