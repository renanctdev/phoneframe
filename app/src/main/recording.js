// Gravação da janela do celular.
//
// - Vídeo: a própria janela do celular (moldura, botões e site), capturada
//   pelo Chromium a partir do id de mídia da janela. A barra de gravação
//   codifica os quadros (WebCodecs + Mediabunny) direto em MP4 e manda os
//   pedaços para cá, que grava em disco.
// - Áudio: só o do site (o <webview>), com o som continuando nas caixas.
// - Telemetria: posição do mouse (~60 Hz) e cliques, com o horário real de
//   cada evento. No fim, o horário do primeiro quadro do vídeo (t0) converte
//   tudo para a linha do tempo do vídeo (veja finished()).
// - O cursor do Windows fica oculto sobre o celular durante a gravação (não
//   aparece no vídeo); uma janela sobreposta, que não entra na captura,
//   mostra um círculo de toque para o usuário.
const { BrowserWindow, ipcMain, screen, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { deviceGeometry } = require("../shared/deviceGeometry");
const projects = require("./projects");

const RECBAR_W = 64;
const RECBAR_H = 188;
const SAMPLE_INTERVAL_MS = 16;
const HIDE_CURSOR_CSS = "*{cursor:none!important}";

/**
 * Atraso entre o clique e o site reagir de forma visível no vídeo (renderização
 * + captura). A telemetria é adiada por esse tempo para o círculo de toque e o
 * zoom acompanharem o que aparece na tela, e não o instante do clique.
 */
const CAPTURE_LATENCY_MS = 0;

/** Estado do controlador da janela do celular ativa. */
const ctl = {
  deviceWindow: null,
  device: null,
  scale: 1,
  guest: null,
  recbar: null,
  overlay: null,
  state: "idle", // idle | preparing | recording | saving
  dir: null,
  fd: null,
  bytes: 0,
  samples: [],
  sampler: null,
  shellCssKey: null,
  guestCssKeys: [],
  pressed: false,
  url: "",
  finishedWaiters: [],
};

function alive(win) {
  return win && !win.isDestroyed();
}

function placeRecbar() {
  if (!alive(ctl.recbar) || !alive(ctl.deviceWindow)) return;
  const b = ctl.deviceWindow.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  let x = b.x + b.width + 10;
  if (x + RECBAR_W > area.x + area.width) x = b.x - RECBAR_W - 10;
  x = Math.max(area.x, x);
  const y = Math.min(Math.max(area.y, b.y + 90), area.y + area.height - RECBAR_H);
  ctl.recbar.setBounds({ x, y, width: RECBAR_W, height: RECBAR_H });
}

function placeOverlay() {
  if (alive(ctl.overlay) && alive(ctl.deviceWindow)) ctl.overlay.setBounds(ctl.deviceWindow.getContentBounds());
}

function sendRecbar(channel, payload) {
  if (alive(ctl.recbar)) ctl.recbar.webContents.send(channel, payload);
}

function createRecbar() {
  ctl.recbar = new BrowserWindow({
    width: RECBAR_W,
    height: RECBAR_H,
    parent: ctl.deviceWindow,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: "Gravação",
    webPreferences: {
      preload: path.join(__dirname, "preload-recbar.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  ctl.recbar.loadFile(path.join(__dirname, "..", "renderer", "recbar", "index.html"));
  ctl.recbar.once("ready-to-show", () => {
    placeRecbar();
    ctl.recbar.showInactive();
  });
}

function createOverlay() {
  const bounds = ctl.deviceWindow.getContentBounds();
  ctl.overlay = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    focusable: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  ctl.overlay.setIgnoreMouseEvents(true);
  ctl.overlay.loadFile(path.join(__dirname, "..", "renderer", "overlay", "index.html"));
  ctl.overlay.once("ready-to-show", () => {
    if (!alive(ctl.overlay)) return;
    ctl.overlay.webContents.send("overlay:init", { size: Math.round(38 * ctl.scale) });
    ctl.overlay.showInactive();
  });
}

function destroyOverlay() {
  if (alive(ctl.overlay)) ctl.overlay.destroy();
  ctl.overlay = null;
}

// ---- cursor oculto sobre o celular -------------------------------------

async function hideCursor() {
  try {
    ctl.shellCssKey = await ctl.deviceWindow.webContents.insertCSS(HIDE_CURSOR_CSS);
  } catch {
    ctl.shellCssKey = null;
  }
  await hideGuestCursor();
}

async function hideGuestCursor() {
  if (!alive(ctl.guest)) return;
  try {
    ctl.guestCssKeys.push(await ctl.guest.insertCSS(HIDE_CURSOR_CSS));
  } catch {
    /* página ainda carregando: dom-ready aplica de novo */
  }
}

function showCursor() {
  if (ctl.shellCssKey && alive(ctl.deviceWindow)) ctl.deviceWindow.webContents.removeInsertedCSS(ctl.shellCssKey).catch(() => {});
  ctl.shellCssKey = null;
  if (alive(ctl.guest)) for (const key of ctl.guestCssKeys) ctl.guest.removeInsertedCSS(key).catch(() => {});
  ctl.guestCssKeys = [];
}

// ---- telemetria ----------------------------------------------------------

function normalizedCursor() {
  const p = screen.getCursorScreenPoint();
  const b = ctl.deviceWindow.getContentBounds();
  const cx = (p.x - b.x) / b.width;
  const cy = (p.y - b.y) / b.height;
  return { cx, cy, px: p.x - b.x, py: p.y - b.y, inside: cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1 };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** Guarda uma amostra com o horário real (ms). A conversão para o tempo do vídeo é feita em finished(). */
function pushSample(interactionType) {
  if (!alive(ctl.deviceWindow)) return null;
  const c = normalizedCursor();
  const sample = {
    wall: Date.now(),
    cx: round4(Math.max(0, Math.min(1, c.cx))),
    cy: round4(Math.max(0, Math.min(1, c.cy))),
    interactionType,
    inside: c.inside,
  };
  ctl.samples.push(sample);
  return { sample, c };
}

function startSampler() {
  stopSampler();
  ctl.sampler = setInterval(() => {
    const r = pushSample("move");
    if (r && alive(ctl.overlay)) ctl.overlay.webContents.send("overlay:cursor", { x: r.c.px, y: r.c.py, inside: r.c.inside, pressed: ctl.pressed });
  }, SAMPLE_INTERVAL_MS);
}

function stopSampler() {
  if (ctl.sampler) clearInterval(ctl.sampler);
  ctl.sampler = null;
}

function onInputEvent(_event, input) {
  if (ctl.state !== "recording" && ctl.state !== "preparing") return;
  if (input.type === "mouseDown") {
    let type = "click";
    if (input.button === "right") type = "right-click";
    else if (input.button === "middle") type = "middle-click";
    else if ((input.clickCount || 1) >= 2) type = "double-click";
    const r = pushSample(type);
    ctl.pressed = true;
    if (r && alive(ctl.overlay)) ctl.overlay.webContents.send("overlay:tap", { x: r.c.px, y: r.c.py });
  } else if (input.type === "mouseUp") {
    pushSample("mouseup");
    ctl.pressed = false;
  }
}

// ---- ciclo de gravação ----------------------------------------------------

/** Para de acompanhar o mouse e devolve o cursor ao normal. */
function cleanupAfterRecording() {
  stopSampler();
  destroyOverlay();
  showCursor();
  ctl.pressed = false;
}

function closeFile() {
  if (ctl.fd !== null) {
    try {
      fs.closeSync(ctl.fd);
    } catch {
      /* já fechado */
    }
    ctl.fd = null;
  }
}

async function prepare() {
  if (ctl.state !== "idle" || !alive(ctl.deviceWindow)) return { ok: false, error: "Gravação indisponível" };
  ctl.state = "preparing";
  try {
    ctl.dir = projects.createProjectDir();
    // MP4 fragmentado (ver recbar.js); o editor gera o source.mp4 comum a partir dele.
    ctl.fd = fs.openSync(path.join(ctl.dir, "raw.mp4"), "w");
    ctl.bytes = 0;
    ctl.samples = [];
    try {
      ctl.url = alive(ctl.guest) ? ctl.guest.getURL() : "";
    } catch {
      ctl.url = "";
    }
    await hideCursor();
    createOverlay();
    startSampler();
    return { ok: true };
  } catch (err) {
    abort();
    return { ok: false, error: String(err.message || err) };
  }
}

/** A captura começou a entregar quadros. */
function started() {
  if (ctl.state === "preparing") ctl.state = "recording";
}

/** Grava um pedaço do MP4 na posição indicada (o MP4 é escrito fora de ordem: o índice vai no fim). */
function writeChunk(position, data) {
  if (ctl.fd === null) return false;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  fs.writeSync(ctl.fd, buf, 0, buf.length, position);
  ctl.bytes += buf.length;
  return true;
}

/** O usuário parou: encerra a captura do mouse já (o MP4 ainda está sendo finalizado). */
function stopping() {
  if (ctl.state === "preparing" || ctl.state === "recording") {
    ctl.state = "saving";
    cleanupAfterRecording();
  }
}

async function finished({ durationMs, t0Wall }) {
  const dir = ctl.dir;
  if (ctl.state !== "saving") stopping();
  try {
    closeFile();
    if (!ctl.bytes) throw new Error("A gravação ficou vazia.");

    // Tempo do vídeo = horário real - t0 (instante do primeiro quadro), mais o
    // atraso entre clicar e o site reagir na imagem capturada.
    const origin = Number.isFinite(t0Wall) ? t0Wall : (ctl.samples[0]?.wall ?? Date.now());
    const samples = [];
    for (const s of ctl.samples) {
      const timeMs = Math.round(s.wall - origin + CAPTURE_LATENCY_MS);
      if (timeMs < 0) continue;
      samples.push({ timeMs, cx: s.cx, cy: s.cy, interactionType: s.interactionType, inside: s.inside });
    }

    const device = ctl.device;
    const bounds = alive(ctl.deviceWindow) ? ctl.deviceWindow.getContentBounds() : { width: 0, height: 0 };
    projects.writeJsonAtomic(path.join(dir, projects.TELEMETRY_FILE), { version: 2, samples });
    projects.writeJsonAtomic(path.join(dir, projects.PROJECT_FILE), {
      version: 1,
      createdAt: new Date().toISOString(),
      name: `${device.name} – ${path.basename(dir)}`,
      url: ctl.url,
      device,
      geometry: deviceGeometry(device),
      recording: {
        file: "raw.mp4",
        mimeType: "video/mp4",
        durationMs: Math.max(0, Math.round(durationMs || 0)),
        windowSize: { width: bounds.width, height: bounds.height },
        scale: ctl.scale,
      },
      edit: null,
    });
    projects.openEditor(dir);
  } catch (err) {
    console.error("Falha ao salvar a gravação:", err);
  } finally {
    ctl.state = "idle";
    ctl.dir = null;
    sendRecbar("rec:state", { state: "idle" });
    for (const done of ctl.finishedWaiters.splice(0)) done();
  }
}

function abort() {
  cleanupAfterRecording();
  closeFile();
  if (ctl.dir) fs.rmSync(ctl.dir, { recursive: true, force: true });
  ctl.dir = null;
  ctl.state = "idle";
  for (const done of ctl.finishedWaiters.splice(0)) done();
}

/** Para a gravação (se houver) e resolve quando o arquivo estiver salvo. */
function stopIfRecording() {
  if (ctl.state === "idle") return Promise.resolve(false);
  return new Promise((resolve) => {
    ctl.finishedWaiters.push(() => resolve(true));
    if (ctl.state === "preparing") sendRecbar("rec:command", "cancel");
    else sendRecbar("rec:command", "stop");
    // Se o gravador não responder (janela travada), não prende o app.
    setTimeout(() => {
      if (ctl.state !== "idle") abort();
    }, 15000);
  });
}

function isActive() {
  return ctl.state !== "idle";
}

// ---- integração com a janela do celular ---------------------------------

function attach(deviceWindow, { device, scale }) {
  detach();
  ctl.deviceWindow = deviceWindow;
  ctl.device = device;
  ctl.scale = scale;
  ctl.guest = null;
  deviceWindow.webContents.on("input-event", onInputEvent);
  deviceWindow.webContents.on("did-attach-webview", (_event, guest) => {
    ctl.guest = guest;
    guest.on("input-event", onInputEvent);
    guest.on("dom-ready", () => {
      if (ctl.state === "preparing" || ctl.state === "recording") hideGuestCursor();
    });
  });
  const follow = () => {
    placeRecbar();
    placeOverlay();
  };
  deviceWindow.on("move", follow);
  deviceWindow.on("closed", () => {
    if (ctl.deviceWindow === deviceWindow) detach();
  });
  createRecbar();
}

function detach() {
  if (ctl.state !== "idle" && ctl.state !== "saving") abort();
  destroyOverlay();
  if (alive(ctl.recbar)) ctl.recbar.destroy();
  ctl.recbar = null;
  ctl.deviceWindow = null;
  ctl.guest = null;
}

function registerRecordingIpc() {
  // Só a barra de gravação pode pedir captura, e só da janela do celular.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const fromRecbar = alive(ctl.recbar) && request.frame && request.frame.processId === ctl.recbar.webContents.getProcessId();
    if (!fromRecbar || ctl.state !== "preparing" || !alive(ctl.deviceWindow)) {
      callback({});
      return;
    }
    const streams = { video: { id: ctl.deviceWindow.getMediaSourceId(), name: "PhoneFrame" } };
    if (request.audioRequested && alive(ctl.guest)) {
      streams.audio = ctl.guest.mainFrame;
      streams.enableLocalEcho = true;
    }
    callback(streams);
  });

  const fromRecbar = (event) => alive(ctl.recbar) && event.sender === ctl.recbar.webContents;
  ipcMain.handle("rec:prepare", (event) => (fromRecbar(event) ? prepare() : { ok: false }));
  ipcMain.on("rec:started", (event) => fromRecbar(event) && started());
  ipcMain.on("rec:stopping", (event) => fromRecbar(event) && stopping());
  ipcMain.handle("rec:chunk", (event, position, data) => (fromRecbar(event) ? writeChunk(position, data) : false));
  ipcMain.handle("rec:finished", (event, info) => (fromRecbar(event) ? finished(info || {}) : false));
  ipcMain.on("rec:failed", (event, message) => {
    if (!fromRecbar(event)) return;
    console.error("Gravação falhou:", message);
    abort();
    sendRecbar("rec:state", { state: "idle", error: message });
  });
  ipcMain.on("rec:open-folder", (event) => {
    if (!fromRecbar(event)) return;
    const root = projects.recordingsRoot();
    fs.mkdirSync(root, { recursive: true });
    shell.openPath(root);
  });
}

module.exports = { attach, detach, isActive, stopIfRecording, registerRecordingIpc };
