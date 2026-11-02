// Animação de zoom e câmera que acompanha o cursor.
//
// Portado do Recordly (https://github.com/webadderallorg/Recordly),
// licenciado sob a AGPL-3.0, autor @webadderall. Arquivos de origem:
//   src/components/video-editor/videoPlayback/{mathUtils,motionSmoothing,
//   zoomRegionUtils,cursorFollowCamera,focusUtils,cursorPosition,
//   sceneMotion,zoomTransform}.ts
// Mudanças: TypeScript → JavaScript; a intensidade do zoom vem de
// region.scale (número) em vez de region.depth; region.follow=false
// equivale ao modo "manual" do Recordly.

// ---- constantes (videoPlayback/constants.ts, zoomRegionUtils.ts) ----------
export const DEFAULT_FOCUS = { cx: 0.5, cy: 0.5 };
export const TRANSITION_WINDOW_MS = 1015.05;
export const ZOOM_IN_TRANSITION_WINDOW_MS = TRANSITION_WINDOW_MS * 1.5;
export const ZOOM_OUT_EARLY_START_MS = 500;
const CHAINED_ZOOM_PAN_GAP_MS = 1350;
const CONNECTED_ZOOM_PAN_DURATION_MS = 1000;
const ZOOM_IN_OVERLAP_MS = 1000;
const ZOOM_ANIMATION_DELAY_MS = 500;
export const SNAP_TO_EDGES_RATIO_AUTO = 0.25;

// ---- mathUtils.ts ----------------------------------------------------------
export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function sampleCubicBezier(a1, a2, t) {
  const u = 1 - t;
  return 3 * a1 * u * u * t + 3 * a2 * u * t * t + t * t * t;
}

function sampleCubicBezierDerivative(a1, a2, t) {
  const u = 1 - t;
  return 3 * a1 * u * u + 6 * (a2 - a1) * u * t + 3 * (1 - a2) * t * t;
}

export function cubicBezier(x1, y1, x2, y2, t) {
  const targetX = clamp01(t);
  let solvedT = targetX;
  for (let i = 0; i < 8; i += 1) {
    const currentX = sampleCubicBezier(x1, x2, solvedT) - targetX;
    const d = sampleCubicBezierDerivative(x1, x2, solvedT);
    if (Math.abs(currentX) < 1e-6 || Math.abs(d) < 1e-6) break;
    solvedT -= currentX / d;
  }
  let lower = 0;
  let upper = 1;
  solvedT = clamp01(solvedT);
  for (let i = 0; i < 10; i += 1) {
    const currentX = sampleCubicBezier(x1, x2, solvedT);
    if (Math.abs(currentX - targetX) < 1e-6) break;
    if (currentX < targetX) lower = solvedT;
    else upper = solvedT;
    solvedT = (lower + upper) / 2;
  }
  return sampleCubicBezier(y1, y2, solvedT);
}

export function easeOutZoom(t) {
  return cubicBezier(0.16, 1, 0.3, 1, t);
}

// ---- motionSmoothing.ts ----------------------------------------------------
export function createSpringState(initialValue = 0) {
  return { value: initialValue, velocity: 0, initialized: false };
}

export function resetSpringState(state, initialValue) {
  if (typeof initialValue === "number") state.value = initialValue;
  state.velocity = 0;
  state.initialized = false;
}

function clampDeltaMs(deltaMs, fallbackMs = 1000 / 60) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return fallbackMs;
  return Math.min(80, Math.max(1, deltaMs));
}

function resolveSpringPosition(t, target, initialDelta, initialVelocity, zeta, omega) {
  if (zeta < 1) {
    const dampedFreq = omega * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega * t);
    return (
      target -
      envelope *
        (((initialVelocity + zeta * omega * initialDelta) / dampedFreq) * Math.sin(dampedFreq * t) +
          initialDelta * Math.cos(dampedFreq * t))
    );
  }
  if (zeta === 1) {
    return target - Math.exp(-omega * t) * (initialDelta + (initialVelocity + omega * initialDelta) * t);
  }
  const dampedFreq = omega * Math.sqrt(zeta * zeta - 1);
  const envelope = Math.exp(-zeta * omega * t);
  const freqT = Math.min(dampedFreq * t, 300);
  return (
    target -
    (envelope * ((initialVelocity + zeta * omega * initialDelta) * Math.sinh(freqT) + dampedFreq * initialDelta * Math.cosh(freqT))) /
      dampedFreq
  );
}

/** Mola amortecida (solução analítica). */
export function stepSpringValue(state, target, deltaMs, config) {
  const safeDeltaMs = clampDeltaMs(deltaMs);
  if (!state.initialized || !Number.isFinite(state.value)) {
    state.value = target;
    state.velocity = 0;
    state.initialized = true;
    return state.value;
  }
  const restDelta = config.restDelta ?? 0.0005;
  const restSpeed = config.restSpeed ?? 0.02;
  if (Math.abs(target - state.value) <= restDelta && Math.abs(state.velocity) <= restSpeed) {
    state.value = target;
    state.velocity = 0;
    return state.value;
  }
  const { stiffness, damping, mass } = config;
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const initialDelta = target - state.value;
  const initialVelocity = -state.velocity;
  const tSec = safeDeltaMs / 1000;
  const current = resolveSpringPosition(tSec, target, initialDelta, initialVelocity, zeta, omega);

  if (zeta >= 1) {
    const crossed = (state.value <= target && current > target) || (state.value >= target && current < target);
    if (crossed) {
      state.value = target;
      state.velocity = 0;
      return state.value;
    }
  }

  const epsilon = 0.0001;
  const ahead = resolveSpringPosition(tSec + epsilon, target, initialDelta, initialVelocity, zeta, omega);
  const velocity = (ahead - current) / epsilon;
  if (Math.abs(velocity) <= restSpeed && Math.abs(target - current) <= restDelta) {
    state.value = target;
    state.velocity = 0;
  } else {
    state.value = current;
    state.velocity = velocity;
  }
  return state.value;
}

export function getCursorSpringConfig(smoothingFactor) {
  const clamped = Math.min(2, Math.max(0, smoothingFactor));
  if (clamped <= 0) return { stiffness: 1000, damping: 100, mass: 1, restDelta: 0.0001, restSpeed: 0.001 };
  if (clamped <= 0.5) {
    const n = clamped / 0.5;
    return { stiffness: (760 - n * 420) * 1.12, damping: 34 + n * 24, mass: 0.85 + n * 0.55, restDelta: 0.0002, restSpeed: 0.01 };
  }
  const n = Math.min(1, (clamped - 0.5) / 1.5);
  return { stiffness: (340 - n * 180) * 1.12, damping: 58 + n * 22, mass: 1.35 + n * 0.45, restDelta: 0.0002, restSpeed: 0.01 };
}

export function getZoomSpringConfig(smoothnessFactor = 0.5) {
  const clamped = Math.max(0, Math.min(1, smoothnessFactor));
  if (clamped <= 0) return { stiffness: 1000, damping: 100, mass: 1, restDelta: 0.0001, restSpeed: 0.001 };
  const scaled = clamped * 2;
  return { stiffness: 100 / scaled, damping: 21, mass: scaled, restDelta: 0.0005, restSpeed: 0.015 };
}

// ---- focusUtils.ts -----------------------------------------------------------
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function clampFocusToScale(focus, zoomScale) {
  const m = 1 / (2 * zoomScale);
  return { cx: clamp(clamp(focus.cx, 0, 1), m, 1 - m), cy: clamp(clamp(focus.cy, 0, 1), m, 1 - m) };
}

// ---- cursorPosition.ts ------------------------------------------------------
export function interpolateCursorPosition(samples, timeMs) {
  if (!samples || samples.length === 0) return null;
  if (timeMs <= samples[0].timeMs) return { cx: samples[0].cx, cy: samples[0].cy };
  const last = samples[samples.length - 1];
  if (timeMs >= last.timeMs) return { cx: last.cx, cy: last.cy };
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b.timeMs - a.timeMs;
  if (span <= 0) return { cx: a.cx, cy: a.cy };
  const t = (timeMs - a.timeMs) / span;
  return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
}

// ---- zoomRegionUtils.ts -------------------------------------------------------
export function computeRegionStrength(region, timeMs, options = {}) {
  const zoomInDurationMs = Math.max(1, options.zoomInDurationMs ?? ZOOM_IN_TRANSITION_WINDOW_MS);
  const zoomOutDurationMs = Math.max(1, options.zoomOutDurationMs ?? TRANSITION_WINDOW_MS);
  const t = timeMs - ZOOM_ANIMATION_DELAY_MS;
  const leadInStart = region.startMs + ZOOM_IN_OVERLAP_MS - ZOOM_IN_TRANSITION_WINDOW_MS;
  let zoomOutStart = region.endMs - ZOOM_OUT_EARLY_START_MS;
  let zoomInEnd = leadInStart + zoomInDurationMs;
  if (zoomInEnd > zoomOutStart) {
    const midpoint = (zoomInEnd + zoomOutStart) / 2;
    zoomInEnd = midpoint;
    zoomOutStart = midpoint;
  }
  const leadOutEnd = zoomOutStart + zoomOutDurationMs;
  if (t < leadInStart || t > leadOutEnd) return 0;
  if (t < zoomInEnd) return easeOutZoom((t - leadInStart) / zoomInDurationMs);
  if (t <= zoomOutStart) return 1;
  return 1 - easeOutZoom(clamp01((t - zoomOutStart) / zoomOutDurationMs));
}

function getConnectedRegionPairs(regions) {
  const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);
  const pairs = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const currentRegion = sorted[i];
    const nextRegion = sorted[i + 1];
    if (nextRegion.startMs - currentRegion.endMs > CHAINED_ZOOM_PAN_GAP_MS) continue;
    pairs.push({
      currentRegion,
      nextRegion,
      transitionStart: currentRegion.endMs + ZOOM_ANIMATION_DELAY_MS,
      transitionEnd: currentRegion.endMs + ZOOM_ANIMATION_DELAY_MS + CONNECTED_ZOOM_PAN_DURATION_MS,
    });
  }
  return pairs;
}

function resolved(region) {
  return { ...region, focus: clampFocusToScale(region.focus, region.scale) };
}

function getActiveRegion(regions, timeMs, pairs, options) {
  const active = regions
    .map((region) => {
      const outgoing = pairs.find((p) => p.currentRegion.id === region.id);
      if (outgoing) {
        if (timeMs >= outgoing.transitionStart) return { region, strength: 0 };
        const zoomOutStart = outgoing.currentRegion.endMs - ZOOM_OUT_EARLY_START_MS + ZOOM_ANIMATION_DELAY_MS;
        if (timeMs >= zoomOutStart) return { region, strength: 1 };
      }
      const incoming = pairs.find((p) => p.nextRegion.id === region.id);
      if (incoming) {
        if (timeMs < incoming.transitionStart) return { region, strength: 0 };
        const nextOut = incoming.nextRegion.endMs - ZOOM_OUT_EARLY_START_MS + ZOOM_ANIMATION_DELAY_MS;
        if (timeMs < nextOut) return { region, strength: 1 };
      }
      return { region, strength: computeRegionStrength(region, timeMs, options) };
    })
    .filter((e) => e.strength > 0)
    .sort((l, r) => (r.strength !== l.strength ? r.strength - l.strength : r.region.startMs - l.region.startMs));
  if (active.length === 0) return null;
  return { region: resolved(active[0].region), strength: active[0].strength };
}

function getConnectedRegionHold(timeMs, pairs) {
  for (const pair of pairs) {
    if (timeMs >= pair.transitionEnd && timeMs < pair.nextRegion.startMs) {
      return { region: resolved(pair.nextRegion), strength: 1 };
    }
  }
  return null;
}

export function findDominantRegion(regions, timeMs, options = {}) {
  const pairs = options.connectZooms ? getConnectedRegionPairs(regions) : [];
  if (options.connectZooms) {
    const hold = getConnectedRegionHold(timeMs, pairs);
    if (hold) return hold;
  }
  return getActiveRegion(regions, timeMs, pairs, options) ?? { region: null, strength: 0 };
}

// ---- cursorFollowCamera.ts -------------------------------------------------
export function createCursorFollowCameraState() {
  return {
    initialized: false,
    lastTimeMs: 0,
    focusX: 0.5,
    focusY: 0.5,
    wasZoomed: false,
    reachedFullZoom: false,
    frozenFocusX: 0.5,
    frozenFocusY: 0.5,
  };
}

export function resetCursorFollowCamera(state) {
  Object.assign(state, createCursorFollowCameraState());
}

function recenterWhenCursorLeavesSafeZone(current, cursor, zoomScale, ratio) {
  const halfSpan = 1 / (2 * Math.max(1, zoomScale));
  const inset = halfSpan * 2 * Math.max(0, Math.min(0.49, ratio));
  let nx = current.cx;
  let ny = current.cy;
  if (cursor.cx < current.cx - halfSpan + inset || cursor.cx > current.cx + halfSpan - inset) nx = cursor.cx;
  if (cursor.cy < current.cy - halfSpan + inset || cursor.cy > current.cy + halfSpan - inset) ny = cursor.cy;
  return clampFocusToScale({ cx: nx, cy: ny }, zoomScale);
}

export function computeCursorFollowFocus(state, samples, timeMs, zoomScale, zoomStrength, regionFocus) {
  const clampedRegionFocus = clampFocusToScale(regionFocus, zoomScale);
  if (zoomStrength < 0.01) {
    if (state.wasZoomed) {
      state.wasZoomed = false;
      state.initialized = false;
      state.reachedFullZoom = false;
    }
    return clampedRegionFocus;
  }
  const cursor = interpolateCursorPosition(samples, timeMs);
  if (!cursor) return state.initialized ? { cx: state.focusX, cy: state.focusY } : clampedRegionFocus;
  if (zoomStrength >= 0.99) state.reachedFullZoom = true;
  if (state.reachedFullZoom && zoomStrength < 0.99) return { cx: state.frozenFocusX, cy: state.frozenFocusY };

  const timeWentBackwards = state.initialized && timeMs + 0.5 < state.lastTimeMs;
  if (!state.initialized || !state.wasZoomed || timeWentBackwards) {
    state.lastTimeMs = timeMs;
    state.initialized = true;
    state.wasZoomed = true;
    state.focusX = state.frozenFocusX = clampedRegionFocus.cx;
    state.focusY = state.frozenFocusY = clampedRegionFocus.cy;
    return clampedRegionFocus;
  }
  state.lastTimeMs = timeMs;
  const target = recenterWhenCursorLeavesSafeZone(
    { cx: state.focusX, cy: state.focusY },
    cursor,
    zoomScale,
    SNAP_TO_EDGES_RATIO_AUTO,
  );
  state.focusX = state.frozenFocusX = target.cx;
  state.focusY = state.frozenFocusY = target.cy;
  return target;
}

// ---- sceneMotion.ts ------------------------------------------------------------
export function resolveSceneZoomTarget({ zoomRegions, timeMs, connectZooms, cursorTelemetry, cursorFollowCamera }) {
  const { region, strength } = findDominantRegion(zoomRegions, timeMs, { connectZooms });
  if (!region || strength <= 0) return { scale: 1, focus: DEFAULT_FOCUS, progress: 0 };
  let focus = region.focus;
  if (region.follow !== false && cursorTelemetry && cursorTelemetry.length > 0) {
    focus = computeCursorFollowFocus(cursorFollowCamera, cursorTelemetry, timeMs, region.scale, strength, region.focus);
  }
  return { scale: region.scale, focus, progress: strength };
}

// ---- zoomTransform.ts (computeZoomTransform) -----------------------------------
export function computeZoomTransform({ stageSize, baseMask, zoomScale, zoomProgress, focusX, focusY }) {
  const p = clamp01(zoomProgress);
  if (p <= 0 || zoomScale <= 1) return { scale: 1, x: 0, y: 0 };
  const fx = baseMask.x + focusX * baseMask.width;
  const fy = baseMask.y + focusY * baseMask.height;
  const scale = 1 + (zoomScale - 1) * p;
  return {
    scale,
    x: (stageSize.width / 2 - fx * zoomScale) * p,
    y: (stageSize.height / 2 - fy * zoomScale) * p,
  };
}
