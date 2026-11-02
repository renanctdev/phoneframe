// Linha do tempo: régua, trilhas de Zoom / Corte / Velocidade / Texto e a
// forma de onda do áudio. Os tempos são sempre os da gravação original.
import { MIN_REGION_MS, TRACKS, TRACK_LABELS } from "./project.js";

const HANDLE_PX = 7;
const SNAP_PX = 6;
const MIN_PX_PER_MS = 0.004;
const MAX_PX_PER_MS = 1.2;

export function fmtTime(ms, withTenths = true) {
  const neg = ms < 0;
  const total = Math.abs(ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const d = Math.floor((total * 10) % 10);
  return `${neg ? "-" : ""}${m}:${String(s).padStart(2, "0")}${withTenths ? `.${d}` : ""}`;
}

function regionLabel(track, r) {
  switch (track) {
    case "zooms":
      return `${r.scale.toFixed(2).replace(/\.?0+$/, "")}× ${r.follow ? "· segue o toque" : "· ponto fixo"}`;
    case "cuts":
      return "Corte";
    case "speeds":
      return `${r.speed}×`;
    case "texts":
      return r.text || "Texto";
    default:
      return "";
  }
}

export class Timeline {
  /**
   * @param {HTMLElement} root
   * @param {import('./project.js').Store} store
   * @param {{getDuration:()=>number, getTime:()=>number, seek:(ms:number)=>void, clicks:number[], isPlaying:()=>boolean}} host
   */
  constructor(root, store, host) {
    this.root = root;
    this.store = store;
    this.host = host;
    this.pxPerMs = 0.05;
    this.fitted = false;
    this.waveform = null;
    this.drag = null;
    this.build();
    store.subscribe(() => this.renderRegions());
    new ResizeObserver(() => {
      if (!this.fitted) this.fit();
      this.layout();
    }).observe(this.scroll);
  }

  build() {
    this.root.innerHTML = `
      <div class="tl-labels">
        <div class="tl-label tl-label--ruler"></div>
        ${TRACKS.map((t) => `<div class="tl-label" data-track="${t}">${TRACK_LABELS[t]}</div>`).join("")}
        <div class="tl-label tl-label--audio">Áudio</div>
      </div>
      <div class="tl-scroll">
        <div class="tl-content">
          <canvas class="tl-ruler"></canvas>
          ${TRACKS.map((t) => `<div class="tl-track" data-track="${t}"></div>`).join("")}
          <div class="tl-audio"><canvas class="tl-wave"></canvas></div>
          <div class="tl-shades"></div>
          <div class="tl-playhead"><div class="tl-playhead__knob"></div></div>
        </div>
      </div>`;
    this.scroll = this.root.querySelector(".tl-scroll");
    this.content = this.root.querySelector(".tl-content");
    this.ruler = this.root.querySelector(".tl-ruler");
    this.wave = this.root.querySelector(".tl-wave");
    this.shades = this.root.querySelector(".tl-shades");
    this.playhead = this.root.querySelector(".tl-playhead");
    this.tracks = Object.fromEntries(TRACKS.map((t) => [t, this.root.querySelector(`.tl-track[data-track="${t}"]`)]));

    this.scroll.addEventListener("scroll", () => this.drawCanvases());
    this.scroll.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.content.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.content.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", () => this.onPointerUp());
  }

  // ---- escala ------------------------------------------------------------
  fit() {
    const dur = this.host.getDuration();
    const w = this.scroll.clientWidth - 24;
    if (dur > 0 && w > 0) {
      this.pxPerMs = Math.max(MIN_PX_PER_MS, Math.min(MAX_PX_PER_MS, w / dur));
      this.fitted = true;
    }
  }

  zoomBy(factor, anchorClientX = null) {
    const rect = this.scroll.getBoundingClientRect();
    const anchorX = anchorClientX === null ? rect.width / 2 : anchorClientX - rect.left;
    const anchorMs = (this.scroll.scrollLeft + anchorX) / this.pxPerMs;
    this.pxPerMs = Math.max(MIN_PX_PER_MS, Math.min(MAX_PX_PER_MS, this.pxPerMs * factor));
    this.layout();
    this.scroll.scrollLeft = anchorMs * this.pxPerMs - anchorX;
    this.drawCanvases();
  }

  onWheel(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      this.scroll.scrollLeft += e.deltaY;
    }
  }

  x(ms) {
    return ms * this.pxPerMs;
  }

  msAt(clientX) {
    const rect = this.content.getBoundingClientRect();
    return Math.max(0, Math.min(this.host.getDuration(), (clientX - rect.left) / this.pxPerMs));
  }

  layout() {
    const dur = this.host.getDuration();
    this.content.style.width = `${Math.max(this.scroll.clientWidth, this.x(dur) + 24)}px`;
    this.renderRegions();
    this.drawCanvases();
    this.setTime(this.host.getTime());
  }

  setWaveform(w) {
    this.waveform = w;
    this.drawCanvases();
  }

  // ---- desenho -----------------------------------------------------------
  renderRegions() {
    const sel = this.store.selection;
    for (const track of TRACKS) {
      const el = this.tracks[track];
      el.textContent = "";
      for (const r of this.store.edit[track]) {
        const div = document.createElement("div");
        div.className = `tl-region tl-region--${track}${r.auto ? " is-auto" : ""}${sel && sel.id === r.id ? " is-selected" : ""}`;
        div.dataset.id = r.id;
        div.dataset.track = track;
        div.style.left = `${this.x(r.startMs)}px`;
        div.style.width = `${Math.max(4, this.x(r.endMs - r.startMs))}px`;
        div.title = `${TRACK_LABELS[track]}: ${fmtTime(r.startMs)} – ${fmtTime(r.endMs)}`;
        div.innerHTML = `<span class="tl-region__h tl-region__h--l"></span><span class="tl-region__label"></span><span class="tl-region__h tl-region__h--r"></span>`;
        div.querySelector(".tl-region__label").textContent = regionLabel(track, r);
        el.appendChild(div);
      }
    }
    this.shades.textContent = "";
    for (const c of this.store.edit.cuts) {
      const s = document.createElement("div");
      s.className = "tl-shade";
      s.style.left = `${this.x(c.startMs)}px`;
      s.style.width = `${this.x(c.endMs - c.startMs)}px`;
      this.shades.appendChild(s);
    }
  }

  drawCanvases() {
    const dpr = window.devicePixelRatio || 1;
    const vw = this.scroll.clientWidth;
    const left = this.scroll.scrollLeft;
    for (const canvas of [this.ruler, this.wave]) {
      const h = canvas.parentElement === this.content ? canvas.clientHeight || 24 : canvas.parentElement.clientHeight;
      canvas.style.left = `${left}px`;
      canvas.style.width = `${vw}px`;
      canvas.width = Math.max(1, Math.round(vw * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    }
    this.drawRuler(left, vw, dpr);
    this.drawWave(left, vw, dpr);
  }

  drawRuler(left, vw, dpr) {
    const ctx = this.ruler.getContext("2d");
    const h = this.ruler.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, h);
    const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
    const major = steps.find((s) => s * this.pxPerMs >= 80) || steps[steps.length - 1];
    const minor = major / 5;
    const startMs = Math.floor(left / this.pxPerMs / minor) * minor;
    const endMs = (left + vw) / this.pxPerMs;
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.textBaseline = "top";
    for (let t = startMs; t <= endMs; t += minor) {
      const x = Math.round(t * this.pxPerMs - left) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? h - 10 : h - 5);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(fmtTime(t, major < 1000), x + 3, 3);
      }
    }
    // cliques gravados
    ctx.fillStyle = "#ffd60a";
    for (const c of this.host.clicks) {
      const x = c * this.pxPerMs - left;
      if (x < -4 || x > vw + 4) continue;
      ctx.beginPath();
      ctx.arc(x, h - 3, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawWave(left, vw, dpr) {
    const ctx = this.wave.getContext("2d");
    const h = this.wave.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, h);
    const w = this.waveform;
    if (!w) {
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText(w === false ? "Sem áudio do site nesta gravação" : "Carregando áudio…", 8, h / 2 + 4);
      return;
    }
    const mid = h / 2;
    ctx.fillStyle = "rgba(100, 210, 255, 0.75)";
    for (let px = 0; px < vw; px++) {
      const a = Math.floor(((left + px) / this.pxPerMs / 1000) * w.rate);
      const b = Math.max(a + 1, Math.floor(((left + px + 1) / this.pxPerMs / 1000) * w.rate));
      let peak = 0;
      for (let i = a; i < b && i < w.peaks.length; i++) peak = Math.max(peak, w.peaks[i]);
      const amp = Math.max(0.5, Math.sqrt(peak) * (h / 2 - 2));
      ctx.fillRect(px, mid - amp, 1, amp * 2);
    }
  }

  setTime(ms) {
    const x = this.x(ms);
    this.playhead.style.transform = `translateX(${x}px)`;
    if (this.host.isPlaying() && !this.drag) {
      const left = this.scroll.scrollLeft;
      const vw = this.scroll.clientWidth;
      if (x > left + vw - 40 || x < left) this.scroll.scrollLeft = x - 40;
    }
  }

  ensureVisible(ms) {
    const x = this.x(ms);
    const left = this.scroll.scrollLeft;
    const vw = this.scroll.clientWidth;
    if (x < left + 20 || x > left + vw - 20) this.scroll.scrollLeft = x - vw / 2;
  }

  // ---- interação -----------------------------------------------------------
  snap(ms, ignoreId) {
    const tol = SNAP_PX / this.pxPerMs;
    const candidates = [this.host.getTime()];
    for (const t of TRACKS) for (const r of this.store.edit[t]) if (r.id !== ignoreId) candidates.push(r.startMs, r.endMs);
    let best = ms;
    let bestD = tol;
    for (const c of candidates) {
      const d = Math.abs(c - ms);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const regionEl = e.target.closest(".tl-region");
    if (regionEl) {
      const track = regionEl.dataset.track;
      const r = this.store.find(track, regionEl.dataset.id);
      if (!r) return;
      // Mede antes de selecionar: a seleção redesenha as regiões e o
      // elemento antigo sai da página (e passaria a medir 0×0).
      const rect = regionEl.getBoundingClientRect();
      let mode = "move";
      if (e.clientX - rect.left <= HANDLE_PX) mode = "start";
      else if (rect.right - e.clientX <= HANDLE_PX) mode = "end";
      this.store.select(track, r.id);
      const span = this.store.freeSpanAt(track, (r.startMs + r.endMs) / 2, this.host.getDuration(), r.id) || { lo: 0, hi: this.host.getDuration() };
      this.drag = { kind: "region", mode, track, id: r.id, startX: e.clientX, orig: { startMs: r.startMs, endMs: r.endMs }, span, moved: false };
      e.preventDefault();
      return;
    }
    // régua ou trilha vazia: posiciona o cursor de reprodução
    if (e.target.closest(".tl-track")) this.store.select(null);
    this.drag = { kind: "scrub" };
    this.host.seek(this.msAt(e.clientX));
    e.preventDefault();
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === "scrub") {
      this.host.seek(this.msAt(e.clientX));
      return;
    }
    const dx = (e.clientX - d.startX) / this.pxPerMs;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
    d.moved = true;
    const { lo, hi } = d.span;
    let { startMs, endMs } = d.orig;
    if (d.mode === "move") {
      const len = endMs - startMs;
      let s = this.snap(startMs + dx, d.id);
      if (s === startMs + dx) {
        const eSnap = this.snap(endMs + dx, d.id);
        s = eSnap - len;
      }
      s = Math.max(lo, Math.min(hi - len, s));
      startMs = s;
      endMs = s + len;
    } else if (d.mode === "start") {
      startMs = Math.max(lo, Math.min(endMs - MIN_REGION_MS, this.snap(startMs + dx, d.id)));
    } else {
      endMs = Math.min(hi, Math.max(startMs + MIN_REGION_MS, this.snap(endMs + dx, d.id)));
    }
    this.store.change(
      (edit) => {
        const r = edit[d.track].find((x) => x.id === d.id);
        if (!r) return;
        r.startMs = Math.round(startMs);
        r.endMs = Math.round(endMs);
        r.auto = false;
      },
      { commit: false, reason: "drag" },
    );
  }

  onPointerUp() {
    if (this.drag?.kind === "region" && this.drag.moved) {
      this.store.change((edit) => edit[this.drag.track].sort((a, b) => a.startMs - b.startMs));
    }
    this.drag = null;
  }

  onDoubleClick(e) {
    const trackEl = e.target.closest(".tl-track");
    if (!trackEl || e.target.closest(".tl-region")) return;
    this.store.addRegion(trackEl.dataset.track, this.msAt(e.clientX), this.host.getDuration());
  }
}
