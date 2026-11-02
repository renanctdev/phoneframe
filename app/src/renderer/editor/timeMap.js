// Mapeia o tempo da gravação (fonte) para o tempo do vídeo final, levando em
// conta os cortes (trechos removidos) e as regiões de velocidade.

/**
 * @returns {Array<{srcStart:number, srcEnd:number, speed:number, outStart:number, outEnd:number}>}
 */
export function buildSegments(durationMs, cuts = [], speeds = []) {
  const points = new Set([0, durationMs]);
  for (const r of [...cuts, ...speeds]) {
    points.add(Math.max(0, Math.min(durationMs, r.startMs)));
    points.add(Math.max(0, Math.min(durationMs, r.endMs)));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segments = [];
  let out = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b - a < 0.5) continue;
    const mid = (a + b) / 2;
    if (cuts.some((c) => mid >= c.startMs && mid < c.endMs)) continue;
    const sp = speeds.find((s) => mid >= s.startMs && mid < s.endMs);
    const speed = sp ? Math.max(0.1, sp.speed) : 1;
    const prev = segments[segments.length - 1];
    if (prev && prev.speed === speed && Math.abs(prev.srcEnd - a) < 0.5) {
      prev.srcEnd = b;
      prev.outEnd = prev.outStart + (prev.srcEnd - prev.srcStart) / speed;
      out = prev.outEnd;
      continue;
    }
    const seg = { srcStart: a, srcEnd: b, speed, outStart: out, outEnd: out + (b - a) / speed };
    out = seg.outEnd;
    segments.push(seg);
  }
  return segments;
}

export function outputDuration(segments) {
  return segments.length ? segments[segments.length - 1].outEnd : 0;
}

/** Segmento que contém o instante da fonte (ou null se estiver num corte). */
export function segmentAtSource(segments, t) {
  for (const s of segments) if (t >= s.srcStart && t < s.srcEnd) return s;
  return null;
}

/** Próximo instante da fonte que entra no vídeo final, a partir de t. */
export function nextKeptSource(segments, t) {
  for (const s of segments) {
    if (t < s.srcEnd) return Math.max(t, s.srcStart);
  }
  return null;
}

export function sourceToOutput(segments, t) {
  for (const s of segments) {
    if (t < s.srcStart) return s.outStart;
    if (t < s.srcEnd) return s.outStart + (t - s.srcStart) / s.speed;
  }
  return outputDuration(segments);
}

export function outputToSource(segments, T) {
  for (const s of segments) {
    if (T < s.outEnd) return s.srcStart + Math.max(0, T - s.outStart) * s.speed;
  }
  const last = segments[segments.length - 1];
  return last ? last.srcEnd : 0;
}
