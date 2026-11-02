// Barra de gravação: captura a janela do celular (getDisplayMedia), codifica
// os quadros com WebCodecs (H.264 + AAC) e manda o MP4 para o processo
// principal gravar em disco.
//
// Por que não usar o MediaRecorder: ele não deixa saber a que horário cada
// quadro foi capturado. Medido neste app, o vídeo saía ~1,4 s atrasado em
// relação aos cliques gravados. Aqui cada quadro leva o carimbo de captura e a
// diferença para o relógio do computador é estimada (veja clockBase), então
// os cliques e o vídeo ficam no mesmo tempo. O codificador também fica sob
// nosso controle (bitrate alto, modo "quality").
import * as mb from "../vendor/mediabunny.mjs";

const bar = document.getElementById("bar");
const recBtn = document.getElementById("recBtn");
const timer = document.getElementById("timer");
const count = document.getElementById("count");

const COUNTDOWN = 3;
const FPS = 60;
const MIN_VIDEO_BITRATE = 16_000_000;
const AUDIO_BITRATE = 192_000;
const AUDIO_WARMUP_CHUNKS = 10; // blocos de ~10 ms usados para alinhar o áudio com o relógio

let state = "idle";
let countdownTimer = null;
let clock = null;
let stream = null;
let capture = null; // { stop(): Promise }
let startWall = 0;

function setState(next, label) {
  state = next;
  bar.dataset.state = next;
  if (label !== undefined) timer.textContent = label;
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function cancelCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  setState("idle", "REC");
}

function startCountdown() {
  let n = COUNTDOWN;
  setState("countdown", "");
  count.textContent = String(n);
  countdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      count.textContent = String(n);
      return;
    }
    clearInterval(countdownTimer);
    countdownTimer = null;
    begin();
  }, 1000);
}

async function getStream() {
  const video = { frameRate: { ideal: FPS, max: FPS } };
  const audio = { echoCancellation: false, autoGainControl: false, noiseSuppression: false, channelCount: 2 };
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video, audio });
  } catch {
    // Sem áudio do site (ex.: página ainda não carregou): grava só a imagem.
    return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  }
}

async function pickAudioCodec() {
  try {
    const aac = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_BITRATE });
    if (aac.supported) return "aac";
  } catch {
    /* sem AAC: usa Opus */
  }
  return "opus";
}

/** H.264 exige largura e altura pares. */
function evenFrame(frame) {
  const w = frame.displayWidth & ~1;
  const h = frame.displayHeight & ~1;
  if (w === frame.displayWidth && h === frame.displayHeight) return frame;
  const cropped = new VideoFrame(frame, { visibleRect: { x: 0, y: 0, width: w, height: h } });
  frame.close();
  return cropped;
}

/**
 * Liga a captura ao codificador. Devolve { stop() }, que finaliza o MP4 e
 * resolve com { durationMs, t0Wall }: t0Wall é o horário real (ms desde 1970,
 * o mesmo relógio da telemetria) do primeiro quadro do vídeo.
 */
async function startCapture(mediaStream, onFirstFrame) {
  const vtrack = mediaStream.getVideoTracks()[0];
  const atrack = mediaStream.getAudioTracks()[0] || null;
  const settings = vtrack.getSettings();
  const pixels = (settings.width || 400) * (settings.height || 800);
  const videoBitrate = Math.round(Math.max(MIN_VIDEO_BITRATE, pixels * FPS * 0.35));

  // MP4 fragmentado: o arquivo fica reproduzível mesmo se o app fechar no meio
  // da gravação. O editor converte para MP4 comum (sem recodificar) ao abrir.
  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: "fragmented" }),
    target: new mb.StreamTarget(
      new WritableStream({ write: (chunk) => window.rec.chunk(chunk.position, chunk.data) }),
      // sem agrupar em blocos grandes: cada fragmento vai para o disco assim que fica pronto
      { chunked: false },
    ),
  });
  const videoSource = new mb.VideoSampleSource({
    codec: "avc",
    bitrate: videoBitrate,
    keyFrameInterval: 2,
    latencyMode: "quality",
  });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  let audioSource = null;
  if (atrack) {
    audioSource = new mb.AudioSampleSource({ codec: await pickAudioCodec(), bitrate: AUDIO_BITRATE });
    output.addAudioTrack(audioSource);
  }
  await output.start();

  // ---- vídeo ---------------------------------------------------------------
  let firstTsMs = null; // carimbo de captura do 1º quadro (relógio da captura)
  let clockBase = Infinity; // menor (chegada - carimbo): relógio real = carimbo + clockBase
  let firstArrival = 0;
  let lastT = -1;
  let lastFrame = null; // último quadro, para segurar a imagem até o fim
  let resolveFirst;
  const firstFrame = new Promise((resolve) => (resolveFirst = resolve));

  const vReader = new MediaStreamTrackProcessor({ track: vtrack }).readable.getReader();
  const videoDone = (async () => {
    for (;;) {
      const { value, done } = await vReader.read();
      if (done || !value) break;
      const arrival = Date.now();
      const tsMs = value.timestamp / 1000;
      clockBase = Math.min(clockBase, arrival - tsMs);
      if (firstTsMs === null) {
        firstTsMs = tsMs;
        firstArrival = arrival;
        onFirstFrame();
        resolveFirst(arrival);
      }
      const t = (tsMs - firstTsMs) / 1000;
      if (t <= lastT) {
        value.close();
        continue;
      }
      lastFrame?.close();
      lastFrame = value.clone();
      const sample = new mb.VideoSample(evenFrame(value), { timestamp: t });
      await videoSource.add(sample);
      sample.close();
      lastT = t;
    }
  })();

  // ---- áudio ---------------------------------------------------------------
  const audioDone = atrack ? runAudio(atrack, audioSource, firstFrame) : Promise.resolve();

  let stopping = null;
  return {
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        const stopWall = Date.now();
        vtrack.stop();
        atrack?.stop();
        await Promise.all([videoDone, audioDone]);

        // Relógio real do 1º quadro: o menor atraso observado é a melhor estimativa.
        const t0Wall = firstTsMs === null ? stopWall : firstTsMs + clockBase;
        const tEnd = Math.max(lastT + 1 / FPS, (stopWall - t0Wall) / 1000);
        if (lastFrame) {
          // Páginas paradas quase não geram quadros: repete o último até o fim.
          const hold = new mb.VideoSample(evenFrame(lastFrame), { timestamp: tEnd });
          await videoSource.add(hold);
          hold.close();
          lastFrame = null;
        }
        videoSource.close();
        audioSource?.close();
        await output.finalize();
        return { durationMs: tEnd * 1000, t0Wall, firstArrival };
      })();
      return stopping;
    },
  };
}

/** Lê o áudio do site, alinha ao relógio do vídeo e preenche buracos com silêncio. */
async function runAudio(atrack, audioSource, firstFrame) {
  const reader = new MediaStreamTrackProcessor({ track: atrack }).readable.getReader();
  const pending = [];
  let base = Infinity;
  let t0Prov = null;
  let nextT = 0; // fim do último áudio enviado (s)

  const toSample = (data, channels, rate, t) => new mb.AudioSample({ data, format: "f32", numberOfChannels: channels, sampleRate: rate, timestamp: t });

  const push = async (chunk) => {
    const { buf, channels, rate, tsMs } = chunk;
    let t = (tsMs + base - t0Prov) / 1000;
    let data = buf;
    let frames = data.length / channels;
    if (t + frames / rate <= 0) return; // veio antes do 1º quadro de vídeo
    if (t < 0) {
      const drop = Math.min(frames, Math.ceil(-t * rate));
      data = data.subarray(drop * channels);
      frames -= drop;
      t += drop / rate;
    }
    if (t - nextT > 0.005) {
      // buraco: silêncio, para o áudio não adiantar em relação ao vídeo
      let gap = t - nextT;
      let at = nextT;
      while (gap > 0.0005) {
        const part = Math.min(gap, 1);
        const n = Math.round(part * rate);
        await audioSource.add(toSample(new Float32Array(n * channels), channels, rate, at));
        at += n / rate;
        gap -= n / rate;
      }
    } else if (t < nextT - 0.005) {
      const drop = Math.min(frames, Math.round((nextT - t) * rate)); // sobreposição
      data = data.subarray(drop * channels);
      frames -= drop;
      t = nextT;
    }
    if (frames <= 0) return;
    await audioSource.add(toSample(data, channels, rate, t));
    nextT = t + frames / rate;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    const arrival = Date.now();
    const tsMs = value.timestamp / 1000;
    base = Math.min(base, arrival - tsMs);
    const channels = value.numberOfChannels;
    const buf = new Float32Array(value.allocationSize({ planeIndex: 0, format: "f32" }) / 4);
    value.copyTo(buf, { planeIndex: 0, format: "f32" });
    const chunk = { buf, channels, rate: value.sampleRate, tsMs };
    value.close();

    if (t0Prov === null) {
      pending.push(chunk);
      if (pending.length < AUDIO_WARMUP_CHUNKS) continue;
      t0Prov = await firstFrame;
      for (const p of pending.splice(0)) await push(p);
    } else {
      await push(chunk);
    }
  }
  if (t0Prov === null && pending.length) {
    t0Prov = await Promise.race([firstFrame, new Promise((r) => setTimeout(() => r(Date.now()), 500))]);
    for (const p of pending.splice(0)) await push(p);
  }
}

async function begin() {
  setState("preparing", "…");
  const prep = await window.rec.prepare();
  if (!prep.ok) {
    setState("idle", "REC");
    return;
  }
  try {
    stream = await getStream();
    if (state !== "preparing") throw new Error("cancelado");
    capture = await startCapture(stream, () => {
      startWall = Date.now();
      window.rec.started();
      setState("recording", "0:00");
      clock = setInterval(() => (timer.textContent = fmt(Date.now() - startWall)), 250);
    });
    stream.getVideoTracks()[0].addEventListener("ended", stop);
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    capture = null;
    clearInterval(clock);
    window.rec.failed(err.message || err);
    setState("idle", "REC");
  }
}

async function stop() {
  if (state === "preparing") {
    // Ainda sem imagem da captura: cancela e descarta, em vez de ficar preso.
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    capture = null;
    window.rec.failed("cancelado");
    setState("idle", "REC");
    return;
  }
  if (!capture || state !== "recording") return;
  clearInterval(clock);
  setState("saving", "Salvando");
  window.rec.stopping();
  const current = capture;
  capture = null;
  try {
    const info = await current.stop();
    stream = null;
    await window.rec.finished({ durationMs: info.durationMs, t0Wall: info.t0Wall });
  } catch (err) {
    console.error(err);
    window.rec.failed(err.message || err);
  }
}

recBtn.addEventListener("click", () => {
  if (state === "idle") startCountdown();
  else if (state === "countdown") cancelCountdown();
  else if (state === "recording" || state === "preparing") stop();
});

document.getElementById("folderBtn").addEventListener("click", () => window.rec.openFolder());

window.rec.onCommand((cmd) => {
  if (cmd === "stop") {
    if (state === "recording") stop();
    else if (state === "countdown") cancelCountdown();
  } else if (cmd === "cancel") {
    if (state === "countdown") cancelCountdown();
    else if (state === "preparing") setState("idle", "REC");
  }
});

window.rec.onState(({ state: s }) => {
  if (s === "idle") {
    capture = null;
    setState("idle", "REC");
  }
});
