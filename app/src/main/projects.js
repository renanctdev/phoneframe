// Pastas de gravação, janelas do editor e o acesso a arquivos que o editor
// precisa (sempre restrito à pasta do projeto daquela janela).
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const PROJECT_FILE = "project.json";
const TELEMETRY_FILE = "telemetry.json";
const READABLE = new Set(["raw.webm", "raw.mp4", "source.mp4"]);
const WRITABLE = new Set(["source.mp4.part"]);
const BACKGROUND_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

/** webContents.id do editor → pasta do projeto */
const editorDirs = new Map();
/** Chamado quando o último editor fecha (o app decide o que mostrar). */
let onEditorsClosed = () => {};
function setOnEditorsClosed(fn) {
  onEditorsClosed = fn;
}
/** id → { fd, path } de exportações em andamento */
const exportsOpen = new Map();
let nextExportId = 1;

function recordingsRoot() {
  return path.join(app.getPath("videos"), "PhoneFrame");
}

function two(n) {
  return String(n).padStart(2, "0");
}

function createProjectDir() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  let dir = path.join(recordingsRoot(), stamp);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(recordingsRoot(), `${stamp} (${i})`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function isProjectDir(dir) {
  return typeof dir === "string" && fs.existsSync(path.join(dir, PROJECT_FILE));
}

function openEditor(dir) {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1000,
    minHeight: 620,
    show: false,
    backgroundColor: "#16171b",
    title: "Editor – PhoneFrame",
    webPreferences: {
      preload: path.join(__dirname, "preload-editor.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  const id = win.webContents.id;
  editorDirs.set(id, dir);
  win.on("closed", () => {
    editorDirs.delete(id);
    if (editorDirs.size === 0) onEditorsClosed();
  });
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "editor", "index.html"));
  return win;
}

function dirFor(event) {
  const dir = editorDirs.get(event.sender.id);
  if (!dir) throw new Error("Janela sem projeto");
  return dir;
}

function fileIn(dir, name, allowed) {
  if (!allowed.has(name)) throw new Error(`Arquivo não permitido: ${name}`);
  return path.join(dir, name);
}

function registerProjectIpc() {
  ipcMain.handle("editor:load", (event) => {
    const dir = dirFor(event);
    const project = JSON.parse(fs.readFileSync(path.join(dir, PROJECT_FILE), "utf8"));
    let telemetry = { samples: [] };
    try {
      telemetry = JSON.parse(fs.readFileSync(path.join(dir, TELEMETRY_FILE), "utf8"));
    } catch {
      /* gravação sem telemetria: editor funciona sem zoom automático */
    }
    const source = path.join(dir, "source.mp4");
    let backgroundUrl = null;
    const bg = project.edit?.background;
    if (bg?.type === "image" && bg.file && fs.existsSync(path.join(dir, path.basename(bg.file)))) {
      backgroundUrl = pathToFileURL(path.join(dir, path.basename(bg.file))).href;
    }
    return {
      dir,
      project,
      telemetry,
      sourceExists: fs.existsSync(source),
      sourceUrl: pathToFileURL(source).href,
      backgroundUrl,
    };
  });

  ipcMain.handle("editor:save", (event, project) => {
    writeJsonAtomic(path.join(dirFor(event), PROJECT_FILE), project);
    return true;
  });

  ipcMain.handle("editor:file-size", (event, name) => fs.statSync(fileIn(dirFor(event), name, READABLE)).size);

  ipcMain.handle("editor:file-read", (event, name, start, end) => {
    const file = fileIn(dirFor(event), name, READABLE);
    const length = Math.max(0, Math.min(end - start, 64 * 1024 * 1024));
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(file, "r");
    try {
      const read = fs.readSync(fd, buf, 0, length, start);
      return read === length ? buf : buf.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  });

  const partFds = new Map();
  ipcMain.handle("editor:file-write", (event, name, position, data) => {
    const file = fileIn(dirFor(event), name, WRITABLE);
    let fd = partFds.get(file);
    if (fd === undefined) {
      fd = fs.openSync(file, "w");
      partFds.set(file, fd);
    }
    fs.writeSync(fd, Buffer.from(data), 0, data.byteLength, position);
    return true;
  });

  ipcMain.handle("editor:file-finish", (event, name, ok) => {
    const file = fileIn(dirFor(event), name, WRITABLE);
    const fd = partFds.get(file);
    if (fd !== undefined) {
      fs.closeSync(fd);
      partFds.delete(file);
    }
    if (!ok) {
      fs.rmSync(file, { force: true });
      return null;
    }
    const final = file.replace(/\.part$/, "");
    fs.renameSync(file, final);
    return pathToFileURL(final).href;
  });

  ipcMain.handle("editor:save-background", (event, ext, data) => {
    const dir = dirFor(event);
    const clean = String(ext).toLowerCase().replace(/^\./, "");
    if (!BACKGROUND_EXT.has(clean)) throw new Error("Formato de imagem não suportado");
    for (const old of fs.readdirSync(dir)) if (/^fundo\./.test(old)) fs.rmSync(path.join(dir, old), { force: true });
    const file = path.join(dir, `fundo.${clean}`);
    fs.writeFileSync(file, Buffer.from(data));
    return { file: path.basename(file), url: `${pathToFileURL(file).href}?v=${Date.now()}` };
  });

  ipcMain.handle("editor:open-folder", (event) => shell.openPath(dirFor(event)));

  ipcMain.handle("export:choose", async (event, defaultName) => {
    const dir = dirFor(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const safeName = String(defaultName || "video").replace(/[\\/:*?"<>|]+/g, "-");
    const result = await dialog.showSaveDialog(win, {
      title: "Exportar vídeo",
      defaultPath: path.join(dir, `${safeName}.mp4`),
      filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const id = nextExportId++;
    exportsOpen.set(id, { fd: fs.openSync(result.filePath, "w"), path: result.filePath, owner: event.sender.id });
    return { id, path: result.filePath };
  });

  const exportEntry = (event, id) => {
    const entry = exportsOpen.get(id);
    if (!entry || entry.owner !== event.sender.id) throw new Error("Exportação inválida");
    return entry;
  };

  ipcMain.handle("export:write", (event, id, position, data) => {
    const entry = exportEntry(event, id);
    fs.writeSync(entry.fd, Buffer.from(data), 0, data.byteLength, position);
    return true;
  });

  ipcMain.handle("export:close", (event, id, ok) => {
    const entry = exportEntry(event, id);
    fs.closeSync(entry.fd);
    exportsOpen.delete(id);
    if (!ok) fs.rmSync(entry.path, { force: true });
    return ok ? entry.path : null;
  });

  ipcMain.handle("export:reveal", (_event, file) => {
    if (typeof file === "string" && fs.existsSync(file)) shell.showItemInFolder(file);
  });

  ipcMain.handle("picker:open-recording", async (event) => {
    const root = recordingsRoot();
    fs.mkdirSync(root, { recursive: true });
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "Abrir gravação",
      defaultPath: root,
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    const dir = result.filePaths[0];
    if (!isProjectDir(dir)) return { ok: false, error: "Essa pasta não tem uma gravação do PhoneFrame." };
    openEditor(dir);
    return { ok: true };
  });
}

module.exports = {
  PROJECT_FILE,
  TELEMETRY_FILE,
  recordingsRoot,
  createProjectDir,
  writeJsonAtomic,
  openEditor,
  registerProjectIpc,
  setOnEditorsClosed,
};
