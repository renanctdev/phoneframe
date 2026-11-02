// Acesso aos arquivos da gravação (via processo principal), conversão do
// arquivo cru para MP4, forma de onda e processamento do áudio exportado.
import * as mb from "../vendor/mediabunny.mjs";

const api = window.editorApi;

/** Fonte do mediabunny que lê o arquivo do projeto aos pedaços. */
export function projectSource(name) {
  return new mb.CustomSource({
    getSize: () => api.fileSize(name),
    read: async (start, end) => new Uint8Array(await api.fileRead(name, start, end)),
    maxCacheSize: 32 * 1024 * 1024,
  });
}

export function openInput(name) {
  return new mb.Input({ source: projectSource(name), formats: mb.ALL_FORMATS });
}

function writableTo(write) {
  return new WritableStream({
    write: (chunk) => write(chunk.position, chunk.data),
  });
}

/**
 * Converte a gravação bruta (raw.mp4 fragmentado, ou raw.webm das versões
 * antigas) em source.mp4 comum, sem recodificar, para a prévia conseguir
 * pular para qualquer ponto do vídeo.
 */
export async function remuxRecording(onProgress, rawName = "raw.mp4") {
  const input = openInput(rawName);
  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: false }),
    target: new mb.StreamTarget(writableTo((pos, data) => api.fileWrite("source.mp4.part", pos, data)), { chunked: true }),
  });
  let ok = false;
  try {
    const conversion = await mb.Conversion.init({ input, output });
    if (!conversion.isValid) throw new Error("Não foi possível converter a gravação.");
    conversion.onProgress = (p) => onProgress?.(p);
    await conversion.execute();
    ok = true;
  } finally {
    input.dispose?.();
  }
  return api.fileFinish("source.mp4.part", ok).then((url) => {
    if (!url) throw new Error("Falha ao salvar o vídeo convertido.");
    return url;
  });
}

/** Picos do áudio (0..1) em blocos de 1/rate segundos. */
export async function computeWaveform(rate = 50) {
  const input = openInput("source.mp4");
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const duration = await input.computeDuration();
    const peaks = new Float32Array(Math.ceil(duration * rate) + 1);
    const sink = new mb.AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers()) {
      const sr = buffer.sampleRate;
      const data = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) data.push(buffer.getChannelData(c));
      for (let i = 0; i < buffer.length; i += 4) {
        const bucket = Math.floor((timestamp + i / sr) * rate);
        if (bucket < 0 || bucket >= peaks.length) continue;
        let v = 0;
        for (const ch of data) v = Math.max(v, Math.abs(ch[i]));
        if (v > peaks[bucket]) peaks[bucket] = v;
      }
    }
    return { rate, peaks };
  } finally {
    input.dispose?.();
  }
}

// ---- áudio do vídeo final ----------------------------------------------------

/**
 * WSOLA: muda a velocidade do áudio mantendo o tom da voz/música.
 * @param {Float32Array[]} channels
 */
export function timeStretch(channels, speed, sampleRate) {
  const nIn = channels[0].length;
  const nOut = Math.max(0, Math.floor(nIn / speed));
  const frame = Math.round(0.04 * sampleRate);
  const hopOut = frame >> 1;
  const hopIn = hopOut * speed;
  const tol = Math.round(0.012 * sampleRate);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));
  const out = channels.map(() => new Float32Array(nOut + frame));
  const norm = new Float32Array(nOut + frame);
  const ref = channels[0];
  let prev = 0;
  for (let k = 0; k * hopOut < nOut; k++) {
    const outPos = k * hopOut;
    const nominal = Math.round(k * hopIn);
    let best = Math.min(nominal, Math.max(0, nIn - frame));
    if (k > 0) {
      const natural = prev + hopOut;
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(nIn - frame, nominal + tol);
      for (let cand = lo; cand <= hi; cand += 2) {
        let score = 0;
        for (let i = 0; i < hopOut; i += 4) {
          const a = natural + i < nIn ? ref[natural + i] : 0;
          score += a * ref[cand + i];
        }
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    if (best < 0) break;
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < frame && best + i < nIn; i++) dst[outPos + i] += src[best + i] * win[i];
    }
    for (let i = 0; i < frame; i++) norm[outPos + i] += win[i];
    prev = best;
  }
  return out.map((ch) => {
    const res = new Float32Array(nOut);
    for (let i = 0; i < nOut; i++) res[i] = norm[i] > 1e-3 ? ch[i] / norm[i] : 0;
    return res;
  });
}

/** Lê o PCM de [startSec, endSec) com exatamente `frames` amostras por canal. */
async function readPcm(sink, startSec, endSec, sampleRate, channelsCount) {
  const frames = Math.max(0, Math.round((endSec - startSec) * sampleRate));
  const out = Array.from({ length: channelsCount }, () => new Float32Array(frames));
  for await (const { buffer, timestamp } of sink.buffers(startSec, endSec)) {
    const offset = Math.round((timestamp - startSec) * sampleRate);
    for (let c = 0; c < channelsCount; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      const from = Math.max(0, -offset);
      const to = Math.min(src.length, frames - offset);
      if (to > from) out[c].set(src.subarray(from, to), offset + from);
    }
  }
  return out;
}

/**
 * Gera o áudio do vídeo final, trecho a trecho (respeitando cortes e
 * velocidades), em blocos de no máximo ~2 s.
 */
export async function* outputAudioBuffers(track, segments, volume = 1) {
  const sampleRate = track.sampleRate;
  const channelsCount = Math.min(2, track.numberOfChannels || 2);
  const sink = new mb.AudioBufferSink(track);
  const CHUNK = sampleRate * 2;
  for (const seg of segments) {
    const expected = Math.round((seg.outEnd / 1000) * sampleRate) - Math.round((seg.outStart / 1000) * sampleRate);
    if (expected <= 0) continue;
    // blocos da fonte: velocidade 1 lê aos poucos; outras velocidades leem o trecho todo
    const srcStep = seg.speed === 1 ? 2 : Infinity;
    let emitted = 0;
    for (let a = seg.srcStart / 1000; a < seg.srcEnd / 1000 - 1e-6; a += srcStep) {
      const b = Math.min(seg.srcEnd / 1000, a + srcStep);
      let pcm = await readPcm(sink, a, b, sampleRate, channelsCount);
      if (seg.speed !== 1) pcm = timeStretch(pcm, seg.speed, sampleRate);
      const isLast = b >= seg.srcEnd / 1000 - 1e-6;
      let len = pcm[0].length;
      if (isLast) len = expected - emitted; // fecha o trecho no tamanho exato
      len = Math.max(0, Math.min(len, expected - emitted));
      for (let off = 0; off < len; off += CHUNK) {
        const n = Math.min(CHUNK, len - off);
        const buf = new AudioBuffer({ length: n, numberOfChannels: channelsCount, sampleRate });
        for (let c = 0; c < channelsCount; c++) {
          const part = new Float32Array(n);
          const src = pcm[c];
          for (let i = 0; i < n; i++) {
            const v = off + i < src.length ? src[off + i] * volume : 0;
            part[i] = v > 1 ? 1 : v < -1 ? -1 : v;
          }
          buf.copyToChannel(part, c);
        }
        yield buf;
      }
      emitted += len;
    }
  }
}

export { mb };
