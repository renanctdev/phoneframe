// Sugestões automáticas de zoom a partir dos cliques gravados.
//
// Portado do Recordly (https://github.com/webadderallorg/Recordly),
// licenciado sob a AGPL-3.0, autor @webadderall. Origem:
//   src/components/video-editor/timeline/zoomSuggestionUtils.ts
// Mudanças: TypeScript → JavaScript; só a parte usada pelas sugestões
// (cliques explícitos). As heurísticas de "parada do cursor" do original
// também são descartadas lá na hora de sugerir zooms.

export const CLICK_CLUSTER_MERGE_GAP_MS = 2500;
export const CLICK_CLUSTER_PAD_MS = 500;
/**
 * Antecedência do zoom em relação ao 1º toque. No Recordly é igual ao PAD (500
 * ms), mas lá o zoom ainda leva ~0,4 s para sair do lugar e a mola da câmera
 * atrasa mais ~0,15 s: no instante do clique ele estava em ~72%, o que dava a
 * impressão de zoom atrasado. Com 700 ms ele já está em ~92% no clique.
 */
export const CLICK_CLUSTER_LEAD_MS = 700;
const EXPLICIT_CLICK_TYPES = new Set(["click", "double-click", "right-click", "middle-click"]);

function classifyPostClickBehavior(samples, click) {
  if (click.interactionType === "double-click") return "double-click-like";
  const clickTime = click.timeMs;
  const mouseUp = samples.find((s) => s.interactionType === "mouseup" && s.timeMs > clickTime && s.timeMs - clickTime < 3000);
  if (mouseUp) {
    const dx = Math.abs(mouseUp.cx - click.cx);
    const dy = Math.abs(mouseUp.cy - click.cy);
    if (mouseUp.timeMs - clickTime >= 200 && dx > 0.03 && dx > dy * 1.8) return "text-selection";
  }
  const moves = samples.filter(
    (s) => s.timeMs > clickTime + 100 && s.timeMs <= clickTime + 2000 && (s.interactionType === "move" || !s.interactionType),
  );
  if (moves.length < 3) return "text-field-click";
  let maxDist = 0;
  let totalDy = 0;
  let totalDx = 0;
  for (const s of moves) {
    maxDist = Math.max(maxDist, Math.hypot(s.cx - click.cx, s.cy - click.cy));
    totalDx += Math.abs(s.cx - click.cx);
    totalDy += Math.abs(s.cy - click.cy);
  }
  if (maxDist < 0.02) return "text-field-click";
  const netDy = moves[moves.length - 1].cy - click.cy;
  if (netDy > 0.03 && totalDy > totalDx * 1.5) return "dropdown-open";
  if (totalDx > 0.03 && totalDx > totalDy * 1.8) return "text-selection";
  return "click-like";
}

const STRENGTH = {
  "double-click-like": 1500,
  "text-selection": 1300,
  "dropdown-open": 1200,
  "text-field-click": 1100,
};

function buildClickClusters(clicks, mergeGapMs) {
  if (clicks.length === 0) return [];
  const sorted = [...clicks].sort((a, b) => a.centerTimeMs - b.centerTimeMs);
  const clusters = [];
  let start = sorted[0].centerTimeMs;
  let end = start;
  let bestStrength = sorted[0].strength;
  let bestFocus = sorted[0].focus;
  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.centerTimeMs - end <= mergeGapMs) {
      end = Math.max(end, c.centerTimeMs);
      if (c.strength > bestStrength) {
        bestStrength = c.strength;
        bestFocus = c.focus;
      }
    } else {
      clusters.push({ firstMs: start, lastMs: end, focus: bestFocus });
      start = end = c.centerTimeMs;
      bestStrength = c.strength;
      bestFocus = c.focus;
    }
  }
  clusters.push({ firstMs: start, lastMs: end, focus: bestFocus });
  return clusters;
}

/**
 * @param {{cursorTelemetry: Array, totalMs: number, reservedSpans?: Array<{start:number,end:number}>}} params
 * @returns {{status: string, suggestions: Array<{start:number,end:number,focus:{cx:number,cy:number}}>}}
 */
export function buildInteractionZoomSuggestions({
  cursorTelemetry,
  totalMs,
  reservedSpans = [],
  mergeGapMs = CLICK_CLUSTER_MERGE_GAP_MS,
  padMs = CLICK_CLUSTER_PAD_MS,
  leadMs = CLICK_CLUSTER_LEAD_MS,
}) {
  if (totalMs <= 0) return { status: "no-slots", suggestions: [] };
  const samples = [...cursorTelemetry]
    .filter((s) => Number.isFinite(s.timeMs) && Number.isFinite(s.cx) && Number.isFinite(s.cy))
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((s) => ({
      ...s,
      timeMs: Math.max(0, Math.min(s.timeMs, totalMs)),
      cx: Math.max(0, Math.min(s.cx, 1)),
      cy: Math.max(0, Math.min(s.cy, 1)),
    }));
  if (samples.length === 0) return { status: "no-telemetry", suggestions: [] };

  const clicks = samples
    .filter((s) => EXPLICIT_CLICK_TYPES.has(s.interactionType))
    .map((s) => {
      const kind = classifyPostClickBehavior(samples, s);
      return { centerTimeMs: Math.round(s.timeMs), focus: { cx: s.cx, cy: s.cy }, strength: STRENGTH[kind] ?? 900, kind };
    });
  if (clicks.length === 0) return { status: "no-interactions", suggestions: [] };

  const reserved = [...reservedSpans].sort((a, b) => a.start - b.start);
  const suggestions = [];
  for (const cluster of buildClickClusters(clicks, mergeGapMs)) {
    const start = Math.max(0, cluster.firstMs - leadMs);
    const end = Math.min(totalMs, cluster.lastMs + padMs);
    if (end <= start) continue;
    if (reserved.some((span) => end > span.start && start < span.end)) continue;
    reserved.push({ start, end });
    suggestions.push({ start, end, focus: cluster.focus });
  }
  if (suggestions.length === 0) return { status: "no-slots", suggestions: [] };
  suggestions.sort((a, b) => a.start - b.start);
  return { status: "ok", suggestions };
}
