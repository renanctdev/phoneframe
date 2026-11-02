// Monta cada quadro do vídeo final: fundo, sombra, celular (recortado no
// formato real do aparelho), câmera com zoom, indicador de toque e textos.
// O mesmo código desenha a prévia e a exportação.
import {
  computeZoomTransform,
  createCursorFollowCameraState,
  createSpringState,
  getCursorSpringConfig,
  getZoomSpringConfig,
  interpolateCursorPosition,
  resetCursorFollowCamera,
  resetSpringState,
  resolveSceneZoomTarget,
  stepSpringValue,
} from "./motion/recordly.js";
import { GRADIENTS } from "./project.js";

const CLICK_TYPES = new Set(["click", "double-click", "right-click", "middle-click"]);
const SIDE_BUTTON_W = 6; // .side-button { width: 6px } no device-shell.css
const TOUCH_RADIUS = 19; // pontos de design (≈ ponta do dedo)
const RIPPLE_MS = 520;
const BOUNCE_MS = 350;
const TEXT_FADE_MS = 200;

let sharpness = 0;
/** Ajusta o núcleo 3×3 do filtro de nitidez (0 = desligado, 1 = forte). */
function setSharpness(amount) {
  sharpness = Math.max(0, Math.min(1, Number(amount) || 0));
  const kernel = document.getElementById("sim-sharpen-kernel");
  if (!kernel) return;
  const a = sharpness * 0.3;
  kernel.setAttribute("kernelMatrix", `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`);
}

export function stageSizeFor(edit) {
  const long = edit.resolution === 720 ? 1280 : 1920;
  const short = edit.resolution === 720 ? 720 : 1080;
  return edit.format === "9:16" ? { width: short, height: long } : { width: long, height: short };
}

function lowerBound(samples, t) {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timeMs < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createMotion() {
  return {
    camera: createCursorFollowCameraState(),
    scale: createSpringState(1),
    x: createSpringState(0),
    y: createSpringState(0),
    tx: createSpringState(0.5),
    ty: createSpringState(0.5),
    lastT: null,
    transform: { scale: 1, x: 0, y: 0 },
  };
}

export function resetMotion(m) {
  resetCursorFollowCamera(m.camera);
  for (const k of ["scale", "x", "y", "tx", "ty"]) resetSpringState(m[k]);
  m.lastT = null;
}

export class Compositor {
  constructor(project, telemetry) {
    this.geometry = project.geometry;
    this.samples = (telemetry?.samples || []).filter((s) => Number.isFinite(s.timeMs));
    this.moves = this.samples.filter((s) => !s.interactionType || s.interactionType === "move");
    this.clicks = this.samples.filter((s) => CLICK_TYPES.has(s.interactionType));
    this.ups = this.samples.filter((s) => s.interactionType === "mouseup");
    this.edit = null;
    this.bgImage = null;
    this.bgCache = null;
    this.bgKey = "";
  }

  setEdit(edit, bgImage) {
    this.edit = edit;
    this.bgImage = bgImage || null;
    this.stage = stageSizeFor(edit);
    this.mask = this.computeMask();
    setSharpness(edit.sharpen ?? 0);
  }

  computeMask() {
    const { width: W, height: H } = this.stage;
    const g = this.geometry;
    const p = Math.max(0, Math.min(0.3, this.edit.padding));
    const boxW = W - 2 * p * Math.min(W, H);
    const boxH = H - 2 * p * Math.min(W, H);
    const aspect = g.windowW / g.windowH;
    let w = boxW;
    let h = w / aspect;
    if (h > boxH) {
      h = boxH;
      w = h * aspect;
    }
    return { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h };
  }

  /** Silhueta do aparelho (corpo + botões laterais) em coordenadas do quadro. */
  silhouettePath(ctx, inset = 0) {
    const g = this.geometry;
    const m = this.mask;
    const k = m.width / g.windowW;
    ctx.beginPath();
    roundRectPath(ctx, m.x + (g.overhang + inset) * k, m.y + inset * k, (g.bodyW - 2 * inset) * k, (g.bodyH - 2 * inset) * k, (g.bodyRadius - inset) * k);
    for (const b of g.buttons || []) {
      const top = Math.round(b.top * g.bodyH);
      const height = Math.round(b.height * g.bodyH);
      const left = b.side === "left" ? 0 : g.windowW - SIDE_BUTTON_W;
      roundRectPath(ctx, m.x + left * k, m.y + top * k, SIDE_BUTTON_W * k, height * k, 2 * k);
    }
  }

  // ---- fundo ------------------------------------------------------------
  backgroundLayer() {
    const e = this.edit;
    const key = JSON.stringify([e.background, e.padding, e.shadow, e.format, e.resolution, !!this.bgImage]);
    if (this.bgCache && key === this.bgKey) return this.bgCache;
    const { width: W, height: H } = this.stage;
    const canvas = this.bgCache || document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    this.paintBackground(ctx, W, H);

    if (e.shadow > 0) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.25 + 0.45 * e.shadow})`;
      ctx.shadowBlur = Math.min(W, H) * 0.06 * e.shadow;
      ctx.shadowOffsetY = Math.min(W, H) * 0.018 * e.shadow;
      ctx.fillStyle = "#000";
      this.silhouettePath(ctx, 2);
      ctx.fill();
      ctx.restore();
    }
    this.bgCache = canvas;
    this.bgKey = key;
    return canvas;
  }

  paintBackground(ctx, W, H) {
    const bg = this.edit.background;
    if (bg.type === "image" && this.bgImage) {
      const img = this.bgImage;
      const s = Math.max(W / img.width, H / img.height);
      const blur = Math.max(0, bg.blur || 0);
      ctx.save();
      if (blur > 0) ctx.filter = `blur(${blur * Math.min(W, H) * 0.02}px)`;
      const extra = blur > 0 ? 1.08 : 1; // esconde a borda clara do desfoque
      const w = img.width * s * extra;
      const h = img.height * s * extra;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      ctx.restore();
      return;
    }
    if (bg.type === "color") {
      ctx.fillStyle = bg.color || "#20232a";
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const grad = GRADIENTS[bg.preset] || GRADIENTS.aurora;
    const a = (grad.angle * Math.PI) / 180;
    const len = Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a));
    const dx = (Math.sin(a) * len) / 2;
    const dy = (-Math.cos(a) * len) / 2;
    const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    grad.stops.forEach((c, i) => g.addColorStop(i / (grad.stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- câmera ------------------------------------------------------------
  /** Mantém a área visível dentro do quadro (o celular é menor que o quadro). */
  clampFocusToStage(focus, scale) {
    const { width: W, height: H } = this.stage;
    const m = this.mask;
    const fx = Math.max(W / (2 * scale), Math.min(W - W / (2 * scale), m.x + focus.cx * m.width));
    const fy = Math.max(H / (2 * scale), Math.min(H - H / (2 * scale), m.y + focus.cy * m.height));
    return { cx: (fx - m.x) / m.width, cy: (fy - m.y) / m.height };
  }

  /**
   * Avança a câmera até o instante (tempo da gravação).
   * mode "spring": anima como na exportação; "snap": vai direto ao alvo.
   */
  step(motion, timeMs, mode = "spring") {
    const e = this.edit;
    const target = resolveSceneZoomTarget({
      zoomRegions: e.zooms,
      timeMs,
      connectZooms: e.zoom.connect,
      cursorTelemetry: this.moves,
      cursorFollowCamera: motion.camera,
    });
    let focus = target.focus;
    if (target.scale > 1) focus = this.clampFocusToStage(focus, target.scale);
    const projected = computeZoomTransform({
      stageSize: this.stage,
      baseMask: this.mask,
      zoomScale: target.scale,
      zoomProgress: target.progress,
      focusX: focus.cx,
      focusY: focus.cy,
    });

    let delta = motion.lastT === null ? 1000 / 60 : timeMs - motion.lastT;
    const jump = motion.lastT === null || delta < 0 || delta > 400;
    motion.lastT = timeMs;
    const snap = mode === "snap" || jump;
    const cfg = getZoomSpringConfig(e.zoom.smoothness);
    if (snap) {
      resetSpringState(motion.scale, projected.scale);
      resetSpringState(motion.x, projected.x);
      resetSpringState(motion.y, projected.y);
      delta = 1000 / 60;
    }
    motion.transform = {
      scale: stepSpringValue(motion.scale, projected.scale, delta, cfg),
      x: stepSpringValue(motion.x, projected.x, delta, cfg),
      y: stepSpringValue(motion.y, projected.y, delta, cfg),
    };

    // indicador de toque (mola própria, como o cursor do Recordly)
    const cursor = interpolateCursorPosition(this.moves, timeMs);
    if (cursor) {
      const tcfg = getCursorSpringConfig(e.touch.smoothing);
      if (snap) {
        resetSpringState(motion.tx, cursor.cx);
        resetSpringState(motion.ty, cursor.cy);
      }
      motion.touch = {
        cx: stepSpringValue(motion.tx, cursor.cx, delta, tcfg),
        cy: stepSpringValue(motion.ty, cursor.cy, delta, tcfg),
      };
    } else {
      motion.touch = null;
    }
    return motion.transform;
  }

  insideAlpha(t) {
    const s = this.moves;
    if (!s.length) return 0;
    let sum = 0;
    for (const off of [-100, -50, 0, 50, 100]) {
      const i = Math.min(s.length - 1, lowerBound(s, t + off));
      sum += s[i].inside === false ? 0 : 1;
    }
    return sum / 5;
  }

  // ---- desenho -----------------------------------------------------------
  /**
   * @param ctx contexto 2D já escalado para o tamanho do quadro (stage)
   * @param frame imagem do vídeo (HTMLVideoElement, VideoFrame, canvas) ou null
   */
  render(ctx, frame, timeMs, motion) {
    const { width: W, height: H } = this.stage;
    const t = motion.transform;
    ctx.save();
    ctx.transform(t.scale, 0, 0, t.scale, t.x, t.y);
    ctx.drawImage(this.backgroundLayer(), 0, 0);

    ctx.save();
    this.silhouettePath(ctx, 0.6);
    ctx.clip();
    const m = this.mask;
    if (frame) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // A gravação tem poucos pixels (o tamanho do celular na tela) e é ampliada;
      // um realce leve devolve definição ao texto.
      if (sharpness > 0) ctx.filter = "url(#sim-sharpen)";
      ctx.drawImage(frame, m.x, m.y, m.width, m.height);
      ctx.filter = "none";
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(m.x, m.y, m.width, m.height);
    }
    ctx.restore();

    if (this.edit.touch.show && motion.touch) this.drawTouch(ctx, timeMs, motion.touch);
    ctx.restore();

    this.drawTexts(ctx, timeMs, W, H);
  }

  drawTouch(ctx, timeMs, pos) {
    const alpha = this.insideAlpha(timeMs);
    if (alpha <= 0.01) return;
    const e = this.edit.touch;
    const m = this.mask;
    const k = m.width / this.geometry.windowW;
    const r = TOUCH_RADIUS * e.size * k;
    const x = m.x + pos.cx * m.width;
    const y = m.y + pos.cy * m.height;

    // última pressão antes de t
    const ci = lowerBound(this.clicks, timeMs + 0.01) - 1;
    const click = ci >= 0 ? this.clicks[ci] : null;
    const age = click ? timeMs - click.timeMs : Infinity;
    let pressed = false;
    if (click && age < 4000) {
      const up = this.ups.find((u) => u.timeMs >= click.timeMs);
      pressed = !up || up.timeMs > timeMs;
    }
    let scale = 1;
    if (age < BOUNCE_MS) scale = Math.max(0.72, 1 - Math.sin((1 - age / BOUNCE_MS) * Math.PI) * 0.08 * 2);
    else if (pressed) scale = 0.86;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (e.ripple && age < RIPPLE_MS && click) {
      const p = age / RIPPLE_MS;
      const ease = 1 - Math.pow(1 - p, 3);
      ctx.beginPath();
      ctx.arc(m.x + click.cx * m.width, m.y + click.cy * m.height, r * (1 + 1.5 * ease), 0, Math.PI * 2);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = alpha * 0.75 * (1 - p);
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    ctx.beginPath();
    ctx.arc(x, y, r * scale, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.globalAlpha = alpha * (pressed ? 0.6 : 0.38);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.95;
    ctx.lineWidth = Math.max(1.5, r * 0.1);
    ctx.strokeStyle = e.color;
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = r * 0.4;
    ctx.stroke();
    ctx.restore();
  }

  textLayout(ctx, region, W, H) {
    const size = Math.max(8, region.size * H);
    ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    const lines = String(region.text || "").split("\n");
    const lineH = size * 1.2;
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width), size);
    const padX = size * 0.5;
    const padY = size * 0.3;
    const boxW = width + padX * 2;
    const boxH = lines.length * lineH + padY * 2;
    const cx = region.x * W;
    const cy = region.y * H;
    return { size, lines, lineH, boxW, boxH, x: cx - boxW / 2, y: cy - boxH / 2, padY };
  }

  drawTexts(ctx, timeMs, W, H) {
    for (const r of this.edit.texts) {
      if (timeMs < r.startMs || timeMs > r.endMs) continue;
      const fade = Math.min(1, (timeMs - r.startMs) / TEXT_FADE_MS, (r.endMs - timeMs) / TEXT_FADE_MS);
      const L = this.textLayout(ctx, r, W, H);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      if (r.box) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        roundRectPath(ctx, L.x, L.y, L.boxW, L.boxH, L.size * 0.35);
        ctx.fill();
      } else {
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = L.size * 0.25;
      }
      ctx.fillStyle = r.color || "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      L.lines.forEach((line, i) => ctx.fillText(line, L.x + L.boxW / 2, L.y + L.padY + L.lineH * (i + 0.5)));
      ctx.restore();
    }
  }

  // ---- conversões para a interface ----------------------------------------
  /** Ponto do quadro (antes da câmera) → coordenadas normalizadas do celular. */
  stageToMask(sx, sy, transform) {
    const t = transform || { scale: 1, x: 0, y: 0 };
    const x = (sx - t.x) / t.scale;
    const y = (sy - t.y) / t.scale;
    return { cx: (x - this.mask.x) / this.mask.width, cy: (y - this.mask.y) / this.mask.height };
  }

  maskToStage(cx, cy, transform) {
    const t = transform || { scale: 1, x: 0, y: 0 };
    return {
      x: (this.mask.x + cx * this.mask.width) * t.scale + t.x,
      y: (this.mask.y + cy * this.mask.height) * t.scale + t.y,
    };
  }
}
