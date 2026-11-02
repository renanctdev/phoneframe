// Estado da edição: valores padrão, desfazer/refazer e salvamento automático.

export const TRACKS = ["zooms", "cuts", "speeds", "texts"];
export const TRACK_LABELS = { zooms: "Zoom", cuts: "Corte", speeds: "Velocidade", texts: "Texto" };
export const MIN_REGION_MS = 200;
const DEFAULT_LENGTH = { zooms: 2500, cuts: 1500, speeds: 3000, texts: 3000 };

export const GRADIENTS = {
  aurora: { name: "Aurora", angle: 135, stops: ["#7f5af0", "#2cb67d"] },
  oceano: { name: "Oceano", angle: 135, stops: ["#2193b0", "#6dd5ed"] },
  por_do_sol: { name: "Pôr do sol", angle: 135, stops: ["#ff7e5f", "#feb47b"] },
  noite: { name: "Noite", angle: 160, stops: ["#0f2027", "#203a43", "#2c5364"] },
  lavanda: { name: "Lavanda", angle: 135, stops: ["#c471f5", "#fa71cd"] },
  menta: { name: "Menta", angle: 135, stops: ["#43cea2", "#185a9d"] },
  rosa: { name: "Rosa", angle: 135, stops: ["#ee9ca7", "#ffdde1"] },
  grafite: { name: "Grafite", angle: 160, stops: ["#232526", "#414345"] },
};

export function defaultEdit() {
  return {
    format: "16:9",
    resolution: 1080,
    fps: 60,
    background: { type: "gradient", preset: "aurora", color: "#20232a", file: null, blur: 0 },
    padding: 0.08,
    shadow: 0.6,
    sharpen: 0.5,
    touch: { show: true, size: 1, color: "#ffffff", ripple: true, smoothing: 0.3 },
    zoom: { defaultScale: 1.5, smoothness: 0.35, connect: true },
    audio: { volume: 1, muted: false },
    zooms: [],
    cuts: [],
    speeds: [],
    texts: [],
    autoZoomApplied: false,
  };
}

/** Completa campos que faltarem (projetos de versões anteriores). */
export function normalizeEdit(edit) {
  const base = defaultEdit();
  if (!edit) return base;
  const out = { ...base, ...edit };
  for (const key of ["background", "touch", "zoom", "audio"]) out[key] = { ...base[key], ...(edit[key] || {}) };
  for (const t of TRACKS) out[t] = Array.isArray(edit[t]) ? edit[t] : [];
  return out;
}

let idCounter = 0;
export function newId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export class Store {
  constructor(project, saveFn) {
    this.project = project;
    this.project.edit = normalizeEdit(project.edit);
    this.saveFn = saveFn;
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.baseline = JSON.stringify(this.project.edit);
    this.saveTimer = null;
    this.selection = null; // { track, id }
  }

  get edit() {
    return this.project.edit;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    for (const fn of this.listeners) fn(reason);
  }

  /** Altera o estado. Com commit=false (ex.: arrastando) não cria passo de desfazer. */
  change(mutator, { commit = true, reason = "edit" } = {}) {
    mutator(this.project.edit);
    if (commit) this.commit();
    this.scheduleSave();
    this.emit(reason);
  }

  commit() {
    const now = JSON.stringify(this.project.edit);
    if (now === this.baseline) return;
    this.undoStack.push(this.baseline);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.baseline = now;
  }

  undo() {
    this.commit();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.baseline);
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.baseline);
    this.restore(next);
  }

  restore(json) {
    this.project.edit = JSON.parse(json);
    this.baseline = json;
    if (this.selection && !this.find(this.selection.track, this.selection.id)) this.selection = null;
    this.scheduleSave();
    this.emit("restore");
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 600);
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      await this.saveFn(this.project);
    } catch (err) {
      console.error("Falha ao salvar o projeto", err);
    }
  }

  select(track, id) {
    this.selection = track && id ? { track, id } : null;
    this.emit("select");
  }

  selected() {
    if (!this.selection) return null;
    return this.find(this.selection.track, this.selection.id);
  }

  find(track, id) {
    return this.edit[track]?.find((r) => r.id === id) || null;
  }

  /** Espaço livre em volta de t na trilha (as regiões de uma trilha não se sobrepõem). */
  freeSpanAt(track, t, durationMs, ignoreId = null) {
    let lo = 0;
    let hi = durationMs;
    for (const r of this.edit[track]) {
      if (r.id === ignoreId) continue;
      if (r.endMs <= t) lo = Math.max(lo, r.endMs);
      else if (r.startMs > t) hi = Math.min(hi, r.startMs);
      else return null;
    }
    return { lo, hi };
  }

  addRegion(track, t, durationMs, extra = {}) {
    const span = this.freeSpanAt(track, t, durationMs);
    if (!span || span.hi - span.lo < MIN_REGION_MS) return null;
    const len = DEFAULT_LENGTH[track];
    let startMs = t;
    let endMs = Math.min(span.hi, t + len);
    if (endMs - startMs < MIN_REGION_MS) startMs = Math.max(span.lo, endMs - len);
    const region = { id: newId(track), startMs: Math.round(startMs), endMs: Math.round(endMs), ...this.regionDefaults(track), ...extra };
    this.change((e) => {
      e[track].push(region);
      e[track].sort((a, b) => a.startMs - b.startMs);
    });
    this.select(track, region.id);
    return region;
  }

  regionDefaults(track) {
    switch (track) {
      case "zooms":
        return { scale: this.edit.zoom.defaultScale, follow: true, focus: { cx: 0.5, cy: 0.5 }, auto: false };
      case "speeds":
        return { speed: 2 };
      case "texts":
        return { text: "Seu texto aqui", x: 0.5, y: 0.12, size: 0.055, color: "#ffffff", box: true };
      default:
        return {};
    }
  }

  removeRegion(track, id) {
    this.change((e) => {
      e[track] = e[track].filter((r) => r.id !== id);
    });
    if (this.selection?.id === id) this.select(null);
  }
}
