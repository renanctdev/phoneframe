const { app, BrowserWindow, ipcMain, screen, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const pkg = require("../../package.json");
const { DEVICES, getDeviceById } = require("./deviceCatalog");
const { normalizeUrl } = require("./urlUtils");
const { deviceGeometry } = require("../shared/deviceGeometry");
const recording = require("./recording");
const projects = require("./projects");
const { APP_ICON } = require("./appIcon");

// Renderização: GPU por padrão. Sem GPU, rolagem, desfoque e vídeo do site
// passam a ser desenhados pela CPU (medido: ~40% a mais de CPU numa página
// com blur e rolagem contínua). Se o processo de GPU falhar uma vez, o app
// grava a preferência e reabre sem GPU daí em diante.
const SOFTWARE_MARKER = path.join(app.getPath("userData"), "software-render");
const forceSoftware =
  process.env.SIMULADOR_SOFTWARE === "1" ||
  process.argv.includes("--software-render") ||
  fs.existsSync(SOFTWARE_MARKER);
if (forceSoftware) app.disableHardwareAcceleration();

app.on("child-process-gone", (_event, details) => {
  if (forceSoftware || details.type !== "GPU") return;
  if (!["crashed", "launch-failed", "abnormal-exit", "oom"].includes(details.reason)) return;
  try {
    fs.writeFileSync(SOFTWARE_MARKER, `${new Date().toISOString()} ${details.reason}\n`);
  } catch {
    /* sem permissão de escrita: ainda reinicia com a flag */
  }
  app.relaunch({ args: process.argv.slice(1).concat("--software-render") });
  app.exit(0);
});
// Sites passam a detectar suporte a toque ('ontouchstart' in window).
app.commandLine.appendSwitch("touch-events", "enabled");

const PARTITION = "persist:simulador";
const SCREEN_MARGIN = 40;

/** @type {BrowserWindow|null} */
let pickerWindow = null;
/** @type {BrowserWindow|null} */
let deviceWindow = null;
/** Aparelho ativo; usado para ajustar os cabeçalhos HTTP. */
let currentDevice = null;
/** Evita reabrir o seletor enquanto o app está encerrando. */
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

function createPickerWindow() {
  pickerWindow = new BrowserWindow({
    width: 980,
    height: 720,
    title: "PhoneFrame",
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload-picker.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  pickerWindow.setMenuBarVisibility(false);
  pickerWindow.loadFile(path.join(__dirname, "..", "renderer", "picker", "index.html"));
  pickerWindow.on("closed", () => {
    pickerWindow = null;
  });
}

function showPicker() {
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.show();
  else createPickerWindow();
}

function buildCustomDevice(customWidth, customHeight) {
  return {
    id: "custom",
    name: "Dispositivo personalizado",
    category: "custom",
    os: "android",
    innerWidth: Math.max(240, Math.min(2000, Math.round(Number(customWidth)) || 390)),
    innerHeight: Math.max(320, Math.min(3000, Math.round(Number(customHeight)) || 844)),
    pixelRatio: 2,
    userAgent: DEVICES.find((d) => d.category === "android").userAgent,
    notch: "none",
    screenRadius: 24,
    bezel: { top: 8, bottom: 8, side: 8 },
  };
}

async function openSimulator({ deviceId, url, customWidth, customHeight }) {
  const device = deviceId === "custom" ? buildCustomDevice(customWidth, customHeight) : getDeviceById(deviceId);
  if (!device) throw new Error(`Dispositivo desconhecido: ${deviceId}`);
  const targetUrl = normalizeUrl(url);

  if (deviceWindow && !deviceWindow.isDestroyed()) deviceWindow.destroy();
  currentDevice = device;

  const geo = deviceGeometry(device);
  const area = screen.getPrimaryDisplay().workArea;
  const scale = Math.min(1, (area.width - SCREEN_MARGIN) / geo.windowW, (area.height - SCREEN_MARGIN) / geo.windowH);
  const width = Math.ceil(geo.windowW * scale);
  const height = Math.ceil(geo.windowH * scale);

  // A janela É o celular: sem moldura do Windows e transparente. Só o corpo
  // do aparelho é pintado (com cantos suavizados pelo CSS); fora dele o
  // fundo é transparente.
  deviceWindow = new BrowserWindow({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `PhoneFrame – ${device.name}`,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload-shell.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      // Toda a moldura é desenhada no tamanho real e reduzida por zoom.
      zoomFactor: scale,
    },
  });

  const win = deviceWindow;
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(scale);
    win.webContents.send("shell:init", { device, url: targetUrl, scale });
  });
  // Fechar o celular no meio de uma gravação: salva o vídeo antes.
  win.on("close", (event) => {
    if (!recording.isActive()) return;
    event.preventDefault();
    recording.stopIfRecording().then(() => {
      if (!win.isDestroyed()) win.close();
    });
  });
  win.on("closed", () => {
    if (deviceWindow === win) {
      deviceWindow = null;
      if (!quitting && !win.skipPicker) showPicker();
    }
  });
  recording.attach(win, { device, scale });

  await win.loadFile(path.join(__dirname, "..", "renderer", "device-shell", "index.html"));
  pickerWindow?.hide();
}

/** Restringe o <webview> que exibe o site do usuário. */
function hardenWebviews() {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      if (!/^https?:\/\//i.test(params.src || "")) event.preventDefault();
    });

    if (contents.getType() === "webview") {
      // Links que abririam nova aba/janela abrem no próprio "celular",
      // como acontece num navegador mobile.
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) contents.loadURL(url).catch(() => {});
        return { action: "deny" };
      });
      contents.on("will-navigate", (event, url) => {
        if (!/^https?:\/\//i.test(url)) event.preventDefault();
      });
    }
  });
}

function configureSimulatorSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // Ajuste de cabeçalhos HTTP para emulação mobile: User-Agent do aparelho e
  // Client Hints coerentes. Safari no iOS não envia sec-ch-ua*.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (currentDevice) {
      headers["User-Agent"] = currentDevice.userAgent;
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith("sec-ch-ua")) delete headers[key];
      }
      if (currentDevice.os === "android") {
        headers["sec-ch-ua-mobile"] = currentDevice.category === "tablet" ? "?0" : "?1";
        headers["sec-ch-ua-platform"] = '"Android"';
      }
    }
    callback({ requestHeaders: headers });
  });
}

// ---- "Sobre": nome, versão e links (código-fonte e texto da licença) ----------

const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

/** URL https do repositório, tirada do campo "repository" do package.json. */
function repositoryUrl() {
  const repo = pkg.repository;
  const raw = typeof repo === "string" ? repo : repo?.url || "";
  return raw.replace(/^git\+/, "").replace(/\.git$/, "");
}

ipcMain.handle("app:about", () => ({
  name: pkg.productName || pkg.name,
  version: app.getVersion(),
  license: pkg.license,
  repositoryUrl: repositoryUrl(),
  licenseUrl: LICENSE_URL,
}));

// Só abre endereços fixos (nunca uma URL vinda do renderer).
ipcMain.handle("app:open-link", (_event, kind) => {
  const url = kind === "repository" ? repositoryUrl() : kind === "license" ? LICENSE_URL : "";
  if (/^https:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle("picker:open-simulator", async (_event, payload) => {
  try {
    await openSimulator(payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle("shell:normalize-url", (_event, raw) => {
  try {
    return { ok: true, url: normalizeUrl(raw) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.on("shell:change-device", () => {
  if (deviceWindow && !deviceWindow.isDestroyed()) deviceWindow.close();
});

// ✕ do celular: encerra o app, a menos que haja um editor aberto (ou uma
// gravação sendo salva, que abre o editor); aí fecha só o celular.
ipcMain.on("shell:quit", async () => {
  const win = deviceWindow;
  const saved = await recording.stopIfRecording();
  const editorOpen = BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && w !== win && w !== pickerWindow && w.getParentWindow() !== win && w.isVisible(),
  );
  if (!saved && !editorOpen) {
    app.quit();
    return;
  }
  if (win && !win.isDestroyed()) {
    win.skipPicker = true;
    win.close();
  }
});

app.whenReady().then(() => {
  hardenWebviews();
  configureSimulatorSession();
  recording.registerRecordingIpc();
  projects.registerProjectIpc();
  // Fechou o último editor sem celular aberto: volta para o seletor
  // (senão o app ficaria rodando sem nenhuma janela visível).
  projects.setOnEditorsClosed(() => {
    if (!quitting && !(deviceWindow && !deviceWindow.isDestroyed())) showPicker();
  });
  createPickerWindow();
  // Abre uma gravação direto no editor: --editor "<pasta da gravação>"
  const editorArg = process.argv.indexOf("--editor");
  if (editorArg !== -1 && process.argv[editorArg + 1]) {
    const dir = path.resolve(process.argv[editorArg + 1]);
    if (fs.existsSync(path.join(dir, projects.PROJECT_FILE))) projects.openEditor(dir);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
