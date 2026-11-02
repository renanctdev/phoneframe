// Editor: prévia, linha do tempo, painel de ajustes e exportação.
import { MIN_REGION_MS, Store, newId } from "./project.js";
import { Compositor, createMotion, resetMotion } from "./compositor.js";
import { buildSegments, nextKeptSource, outputDuration, segmentAtSource, sourceToOutput } from "./timeMap.js";
import { Timeline, fmtTime } from "./timeline.js";
import { Inspector } from "./inspector.js";
import { computeWaveform, remuxRecording } from "./media.js";
import { buildInteractionZoomSuggestions } from "./motion/zoomSuggestions.js";
import { exportVideo } from "./exporter.js";

const api = window.editorApi;
const $ = (sel) => document.querySelector(sel);

const MIN_AUTO_ZOOM_MS = 2200; // um toque isolado vira um zoom de ~2 s
const IDENTITY = { scale: 1, x: 0, y: 0 };

const video = $("#video");
const preview = $("#preview");
const pctx = preview.getContext("2d");
const stageWrap = $("#stageWrap");

let store;
let comp;
let telemetry;
let motion = createMotion();
let durationMs = 0;
let segments = [];
let playing = false;
let dirty = true;
let bgImage = null;
let pointer = null; // arrasto na prévia
let exporting = false;

// ---- carregamento -----------------------------------------------------------
function setLoading(text, progress) {
  $("#loadingText").textContent = text;
  const bar = $("#loadingBar");
  bar.style.width = progress === undefined ? "100%" : `${Math.round(progress * 100)}%`;
  bar.classList.toggle("is-indeterminate", progress === undefined);
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function waitMetadata() {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) return resolve();
    video.addEventListener("loadedmetadata", resolve, { once: true });
    video.addEventListener("error", () => reject(new Error("Não foi possível abrir o vídeo da gravação.")), { once: true });
  });
}

async function main() {
  setLoading("Abrindo a gravação…");
  const data = await api.load();
  let sourceUrl = data.sourceUrl;
  if (!data.sourceExists) {
    setLoading("Preparando a gravação para edição…", 0);
    sourceUrl = await remuxRecording((p) => setLoading("Preparando a gravação para edição…", p), data.project.recording?.file || "raw.webm");
  }
  video.src = sourceUrl;
  await waitMetadata();
  durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : data.project.recording?.durationMs || 0;

  telemetry = data.telemetry || { samples: [] };
  store = new Store(data.project, (p) => api.save(p));
  comp = new Compositor(data.project, telemetry);
  if (data.backgroundUrl) bgImage = await loadImage(data.backgroundUrl);

  if (!store.edit.autoZoomApplied) {
    generateZooms();
    store.edit.autoZoomApplied = true;
    store.baseline = JSON.stringify(store.edit);
    store.undoStack = [];
    store.saveNow();
  }

  $("#projName").textContent = data.project.device?.name || "Gravação";
  $("#projInfo").textContent = data.project.url ? ` · ${data.project.url}` : "";
  document.title = `Editor – ${data.project.name || "Gravação"}`;

  const clicks = telemetry.samples.filter((s) => s.interactionType && s.interactionType !== "move" && s.interactionType !== "mouseup").map((s) => s.timeMs);
  const timeline = new Timeline($("#timeline"), store, {
    getDuration: () => durationMs,
    getTime: currentMs,
    seek,
    clicks,
    isPlaying: () => playing,
  });
  window.__timeline = timeline;
  new Inspector($("#inspector"), store, {
    seek,
    generateZooms: () => {
      const n = generateZooms();
      return n;
    },
    chooseBackground,
    getDuration: () => durationMs,
  });

  store.subscribe(onEditChanged);
  onEditChanged();
  bindUi(timeline);
  new ResizeObserver(fitPreview).observe(stageWrap);
  fitPreview();
  $("#loading").hidden = true;
  requestAnimationFrame(loop);

  computeWaveform()
    .then((w) => timeline.setWaveform(w || false))
    .catch(() => timeline.setWaveform(false));
}

// ---- zoom automático ------------------------------------------------------------
function generateZooms() {
  const edit = store.edit;
  const kept = edit.zooms.filter((z) => !z.auto);
  const res = buildInteractionZoomSuggestions({
    cursorTelemetry: telemetry.samples,
    totalMs: durationMs,
    reservedSpans: kept.map((z) => ({ start: z.startMs, end: z.endMs })),
  });
  const starts = [...res.suggestions.map((s) => s.start), ...kept.map((z) => z.startMs)].sort((a, b) => a - b);
  const created = res.suggestions.map((s) => {
    const next = starts.find((x) => x > s.start) ?? durationMs;
    const end = Math.max(s.end, Math.min(s.start + MIN_AUTO_ZOOM_MS, next - 50, durationMs));
    return {
      id: newId("zooms"),
      startMs: Math.round(s.start),
      endMs: Math.round(Math.max(end, s.start + MIN_REGION_MS)),
      scale: edit.zoom.defaultScale,
      follow: true,
      focus: { cx: s.focus.cx, cy: s.focus.cy },
      auto: true,
    };
  });
  store.change((e) => {
    e.zooms = [...kept, ...created].sort((a, b) => a.startMs - b.startMs);
  });
  return created.length;
}

async function chooseBackground(file) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const saved = await api.saveBackground(ext, await file.arrayBuffer());
  const img = await loadImage(saved.url);
  if (!img) return;
  bgImage = img;
  store.change((e) => Object.assign(e.background, { type: "image", file: saved.file }));
}

// ---- estado → prévia ------------------------------------------------------------
let lastStageKey = "";
function onEditChanged() {
  const e = store.edit;
  comp.setEdit(e, e.background.type === "image" ? bgImage : null);
  segments = buildSegments(durationMs, e.cuts, e.speeds);
  const key = `${e.format}|${e.resolution}`;
  if (key !== lastStageKey) {
    lastStageKey = key;
    fitPreview();
  }
  video.muted = !!e.audio.muted;
  video.volume = Math.max(0, Math.min(1, e.audio.volume));
  $("#outLabel").textContent = `Vídeo final: ${fmtTime(outputDuration(segments), false)}`;
  $("#undoBtn").disabled = store.undoStack.length === 0 && JSON.stringify(e) === store.baseline;
  $("#redoBtn").disabled = store.redoStack.length === 0;
  dirty = true;
}

function fitPreview() {
  if (!comp) return;
  const { width: W, height: H } = comp.stage;
  const availW = stageWrap.clientWidth - 24;
  const availH = stageWrap.clientHeight - 24;
  if (availW <= 0 || availH <= 0) return;
  const k = Math.min(availW / W, availH / H);
  const cssW = Math.floor(W * k);
  const cssH = Math.floor(H * k);
  preview.style.width = `${cssW}px`;
  preview.style.height = `${cssH}px`;
  const dpr = window.devicePixelRatio || 1;
  preview.width = Math.min(W, Math.round(cssW * dpr));
  preview.height = Math.min(H, Math.round(cssH * dpr));
  dirty = true;
}

function currentMs() {
  return video.currentTime * 1000;
}

function selectedZoomForFocus() {
  const sel = store.selection;
  if (playing || !sel || sel.track !== "zooms") return null;
  const r = store.selected();
  return r && !r.follow ? r : null;
}

function draw(t) {
  const { width: W } = comp.stage;
  const k = preview.width / W;
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.fillStyle = "#000";
  pctx.fillRect(0, 0, preview.width, preview.height);
  pctx.setTransform(k, 0, 0, k, 0, 0);

  comp.step(motion, t, playing ? "spring" : "snap");
  const focusZoom = selectedZoomForFocus();
  if (focusZoom) motion.transform = IDENTITY;
  const frame = video.readyState >= 2 ? video : null;
  comp.render(pctx, frame, t, motion);

  if (focusZoom) drawFocusBox(focusZoom);
  const sel = store.selection;
  if (sel && sel.track === "texts") {
    const r = store.selected();
    if (r && t >= r.startMs && t <= r.endMs) {
      const L = comp.textLayout(pctx, r, comp.stage.width, comp.stage.height);
      pctx.save();
      pctx.setLineDash([8, 6]);
      pctx.lineWidth = 2 / k;
      pctx.strokeStyle = "#0a84ff";
      pctx.strokeRect(L.x - 4, L.y - 4, L.boxW + 8, L.boxH + 8);
      pctx.restore();
    }
  }
}

function drawFocusBox(r) {
  const { width: W, height: H } = comp.stage;
  const focus = comp.clampFocusToStage(r.focus, r.scale);
  const c = comp.maskToStage(focus.cx, focus.cy, IDENTITY);
  const w = W / r.scale;
  const h = H / r.scale;
  pctx.save();
  pctx.fillStyle = "rgba(0,0,0,0.45)";
  pctx.beginPath();
  pctx.rect(0, 0, W, H);
  pctx.rect(c.x - w / 2, c.y - h / 2, w, h);
  pctx.fill("evenodd");
  pctx.strokeStyle = "#0a84ff";
  pctx.lineWidth = 3;
  pctx.strokeRect(c.x - w / 2, c.y - h / 2, w, h);
  pctx.beginPath();
  pctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
  pctx.fillStyle = "#0a84ff";
  pctx.fill();
  pctx.restore();
}

function updateTimeLabel(t) {
  $("#timeLabel").textContent = `${fmtTime(t)} / ${fmtTime(durationMs)}`;
}

function loop() {
  requestAnimationFrame(loop);
  if (!comp) return;
  const t = currentMs();
  if (playing) {
    const seg = segmentAtSource(segments, t);
    if (!seg) {
      const next = nextKeptSource(segments, t);
      if (next === null || next >= durationMs - 5) pause();
      else video.currentTime = next / 1000;
    } else if (Math.abs(video.playbackRate - seg.speed) > 1e-3) {
      video.playbackRate = seg.speed;
    }
    if (video.ended) pause();
  }
  window.__timeline?.setTime(t);
  updateTimeLabel(t);
  if (!playing && !dirty) return;
  dirty = false;
  draw(t);
}

// ---- reprodução ---------------------------------------------------------------
function play() {
  if (playing || exporting) return;
  let t = currentMs();
  if (t >= durationMs - 30) t = 0;
  const next = nextKeptSource(segments, t);
  if (next === null) return;
  if (Math.abs(next - t) > 1) video.currentTime = next / 1000;
  playing = true;
  resetMotion(motion);
  video.play().catch(() => {
    playing = false;
  });
  $("#playBtn").classList.add("is-playing");
}

function pause() {
  playing = false;
  video.pause();
  video.playbackRate = 1;
  $("#playBtn").classList.remove("is-playing");
  dirty = true;
}

function seek(ms) {
  const t = Math.max(0, Math.min(durationMs, ms));
  video.currentTime = t / 1000;
  updateTimeLabel(t);
  window.__timeline?.setTime(t);
  dirty = true;
}

video.addEventListener("seeked", () => (dirty = true));
video.addEventListener("loadeddata", () => (dirty = true));
video.addEventListener("ended", pause);

// ---- interação na prévia ----------------------------------------------------------
function stagePoint(e) {
  const rect = preview.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * comp.stage.width,
    y: ((e.clientY - rect.top) / rect.height) * comp.stage.height,
  };
}

function setFocusFromPoint(p, commit) {
  const r = selectedZoomForFocus();
  if (!r) return;
  const m = comp.stageToMask(p.x, p.y, IDENTITY);
  store.change(
    (e) => {
      const z = e.zooms.find((x) => x.id === r.id);
      z.focus = { cx: Math.max(0, Math.min(1, m.cx)), cy: Math.max(0, Math.min(1, m.cy)) };
      z.auto = false;
    },
    { commit, reason: "preview" },
  );
}

preview.addEventListener("pointerdown", (e) => {
  if (!comp || e.button !== 0) return;
  const p = stagePoint(e);
  if (selectedZoomForFocus()) {
    pointer = { kind: "focus" };
    setFocusFromPoint(p, false);
    preview.setPointerCapture(e.pointerId);
    return;
  }
  const sel = store.selection;
  if (sel && sel.track === "texts") {
    const r = store.selected();
    const t = currentMs();
    if (r && t >= r.startMs && t <= r.endMs) {
      const L = comp.textLayout(pctx, r, comp.stage.width, comp.stage.height);
      if (p.x >= L.x && p.x <= L.x + L.boxW && p.y >= L.y && p.y <= L.y + L.boxH) {
        pointer = { kind: "text", id: r.id, start: p, orig: { x: r.x, y: r.y } };
        preview.setPointerCapture(e.pointerId);
        return;
      }
    }
  }
  pointer = { kind: "toggle" };
});

preview.addEventListener("pointermove", (e) => {
  if (!pointer) return;
  const p = stagePoint(e);
  if (pointer.kind === "focus") setFocusFromPoint(p, false);
  else if (pointer.kind === "text") {
    const { width: W, height: H } = comp.stage;
    const nx = Math.max(0.02, Math.min(0.98, pointer.orig.x + (p.x - pointer.start.x) / W));
    const ny = Math.max(0.02, Math.min(0.98, pointer.orig.y + (p.y - pointer.start.y) / H));
    store.change(
      (ed) => {
        const r = ed.texts.find((x) => x.id === pointer.id);
        if (r) Object.assign(r, { x: nx, y: ny });
      },
      { commit: false, reason: "preview" },
    );
  }
});

preview.addEventListener("pointerup", () => {
  if (!pointer) return;
  if (pointer.kind === "toggle") playing ? pause() : play();
  else store.commit();
  pointer = null;
});

// ---- exportação ---------------------------------------------------------------------
async function runExport() {
  if (exporting) return;
  pause();
  await store.saveNow();
  const modal = $("#exportModal");
  const bar = $("#exportBar");
  const label = $("#exportLabel");
  const done = $("#exportDone");
  const controller = new AbortController();
  exporting = true;
  modal.hidden = false;
  done.hidden = true;
  $("#exportProgress").hidden = false;
  $("#exportCancel").hidden = false;
  $("#exportTitle").textContent = "Exportando vídeo";
  label.textContent = "Escolha onde salvar…";
  bar.style.width = "0%";
  $("#exportCancel").onclick = () => controller.abort();
  const started = performance.now();
  try {
    const file = await exportVideo({
      project: store.project,
      telemetry,
      edit: JSON.parse(JSON.stringify(store.edit)),
      bgImage: store.edit.background.type === "image" ? bgImage : null,
      durationMs,
      signal: controller.signal,
      onProgress: (p, text) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        label.textContent = text;
      },
    });
    if (!file) {
      modal.hidden = true;
      return;
    }
    const secs = ((performance.now() - started) / 1000).toFixed(0);
    $("#exportTitle").textContent = "Vídeo pronto";
    $("#exportProgress").hidden = true;
    $("#exportCancel").hidden = true;
    done.hidden = false;
    $("#exportPath").textContent = file;
    $("#exportTime").textContent = `Exportado em ${secs} s.`;
    $("#exportReveal").onclick = () => api.exportReveal(file);
  } catch (err) {
    if (err?.name === "AbortError") {
      modal.hidden = true;
    } else {
      console.error(err);
      $("#exportTitle").textContent = "Não foi possível exportar";
      $("#exportProgress").hidden = true;
      $("#exportCancel").hidden = true;
      done.hidden = false;
      $("#exportPath").textContent = String(err?.message || err);
      $("#exportTime").textContent = "";
      $("#exportReveal").onclick = null;
    }
  } finally {
    exporting = false;
  }
}

// ---- botões e teclado -------------------------------------------------------------------
function bindUi(timeline) {
  $("#playBtn").addEventListener("click", () => (playing ? pause() : play()));
  $("#undoBtn").addEventListener("click", () => store.undo());
  $("#redoBtn").addEventListener("click", () => store.redo());
  $("#exportBtn").addEventListener("click", runExport);
  $("#folderBtn").addEventListener("click", () => api.openFolder());
  $("#aboutBtn").addEventListener("click", async () => {
    $("#aboutModal").hidden = false;
    try {
      const info = await api.about();
      $("#aboutVersion").textContent = `v${info.version}`;
      $("#aboutRepo").textContent = info.repositoryUrl;
    } catch (err) {
      console.error(err);
    }
  });
  $("#aboutClose").addEventListener("click", () => ($("#aboutModal").hidden = true));
  // Links do "Sobre" abrem no navegador do sistema (o editor nunca navega para fora).
  $("#aboutModal").addEventListener("click", (e) => {
    const link = e.target.closest("[data-link]");
    if (!link) return;
    e.preventDefault();
    api.openLink(link.dataset.link);
  });
  $("#exportClose").addEventListener("click", () => ($("#exportModal").hidden = true));
  $("#tlIn").addEventListener("click", () => timeline.zoomBy(1.5));
  $("#tlOut").addEventListener("click", () => timeline.zoomBy(1 / 1.5));
  $("#tlFit").addEventListener("click", () => {
    timeline.fit();
    timeline.layout();
  });
  for (const b of document.querySelectorAll("[data-add]")) {
    b.addEventListener("click", () => {
      const r = store.addRegion(b.dataset.add, currentMs(), durationMs);
      if (!r) flashToolbar("Não há espaço livre nessa trilha no ponto atual.");
    });
  }

  window.addEventListener("keydown", (e) => {
    if (!$("#exportModal").hidden || !$("#aboutModal").hidden) {
      if (e.key === "Escape" && !exporting) {
        $("#exportModal").hidden = true;
        $("#aboutModal").hidden = true;
      }
      return;
    }
    const tag = document.activeElement?.tagName;
    const typing = tag === "TEXTAREA" || (tag === "INPUT" && !["range", "checkbox", "color", "button"].includes(document.activeElement.type));
    if (typing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if (ctrl && e.key.toLowerCase() === "y") {
      e.preventDefault();
      store.redo();
    } else if (ctrl && e.key.toLowerCase() === "e") {
      e.preventDefault();
      runExport();
    } else if (e.key === " ") {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const sel = store.selection;
      if (sel) {
        e.preventDefault();
        store.removeRegion(sel.track, sel.id);
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.shiftKey ? 1000 : 1000 / 60;
      pause();
      seek(currentMs() + (e.key === "ArrowLeft" ? -step : step));
      timeline.ensureVisible(currentMs());
    } else if (e.key === "Home") {
      seek(0);
      timeline.ensureVisible(0);
    } else if (e.key === "End") {
      seek(durationMs);
      timeline.ensureVisible(durationMs);
    } else if (e.key === "Escape") {
      store.select(null);
    }
  });

  // Só grava ao fechar se houver alteração ainda não salva.
  window.addEventListener("beforeunload", () => {
    if (store.saveTimer) store.saveNow();
  });
}

let flashTimer = null;
function flashToolbar(text) {
  const el = $("#tlMessage");
  el.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.textContent = ""), 2500);
}

// para depuração no console
window.__sourceToOutput = (t) => sourceToOutput(segments, t);

main().catch((err) => {
  console.error(err);
  setLoading(`Erro: ${err.message || err}`);
});
