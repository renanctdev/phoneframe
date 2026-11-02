// Exportação para MP4: decodifica a gravação quadro a quadro, monta cada
// quadro com o Compositor e codifica com WebCodecs (H.264 + AAC) via mediabunny.
import { mb, openInput, outputAudioBuffers } from "./media.js";
import { Compositor, createMotion } from "./compositor.js";
import { buildSegments, outputDuration, outputToSource } from "./timeMap.js";

const api = window.editorApi;

function bitrateFor(width, height, fps) {
  const pixels = width * height;
  const base = pixels >= 1920 * 1080 ? 12_000_000 : 6_000_000;
  return Math.round(base * (fps >= 50 ? 1.4 : 1));
}

async function pickAudioCodec() {
  try {
    const aac = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    if (aac.supported) return "aac";
  } catch {
    /* sem AAC: usa Opus */
  }
  return "opus";
}

/**
 * @param {{project, telemetry, edit, bgImage, durationMs, onProgress:(p:number, label:string)=>void, signal:AbortSignal}} opts
 * @returns {Promise<string|null>} caminho do arquivo ou null se o usuário cancelou a escolha
 */
export async function exportVideo({ project, telemetry, edit, bgImage, durationMs, onProgress, signal }) {
  const target = await api.exportChoose(project.name || "video");
  if (!target) return null;

  const input = openInput("source.mp4");
  let output = null;
  let ok = false;
  try {
    const vtrack = await input.getPrimaryVideoTrack();
    if (!vtrack) throw new Error("A gravação não tem vídeo.");
    const atrack = edit.audio.muted ? null : await input.getPrimaryAudioTrack();
    const firstTs = await vtrack.getFirstTimestamp();

    const comp = new Compositor(project, telemetry);
    comp.setEdit(edit, bgImage);
    const { width: W, height: H } = comp.stage;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false });

    const fps = edit.fps === 30 ? 30 : 60;
    output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: false }),
      target: new mb.StreamTarget(
        new WritableStream({ write: (chunk) => api.exportWrite(target.id, chunk.position, chunk.data) }),
        { chunked: true, chunkSize: 8 * 1024 * 1024 },
      ),
    });
    const videoSource = new mb.CanvasSource(canvas, {
      codec: "avc",
      bitrate: bitrateFor(W, H, fps),
      keyFrameInterval: 2,
      latencyMode: "quality",
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource = null;
    if (atrack) {
      audioSource = new mb.AudioBufferSource({ codec: await pickAudioCodec(), bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    const segments = buildSegments(durationMs, edit.cuts, edit.speeds);
    const totalOut = outputDuration(segments);
    const frames = Math.max(1, Math.ceil((totalOut / 1000) * fps));
    const audioShare = audioSource ? 0.08 : 0;

    if (audioSource) {
      onProgress(0, "Processando o áudio…");
      const volume = Math.max(0, Math.min(2, edit.audio.volume ?? 1));
      let done = 0;
      for await (const buf of outputAudioBuffers(atrack, segments, volume)) {
        if (signal.aborted) throw new DOMException("cancelado", "AbortError");
        await audioSource.add(buf);
        done += buf.duration * 1000;
        onProgress(audioShare * Math.min(1, done / Math.max(1, totalOut)), "Processando o áudio…");
      }
      audioSource.close();
    }

    const srcTimes = new Float64Array(frames);
    for (let i = 0; i < frames; i++) srcTimes[i] = outputToSource(segments, (i / fps) * 1000);
    const timestamps = (function* () {
      for (let i = 0; i < frames; i++) yield Math.max(firstTs, firstTs + srcTimes[i] / 1000);
    })();

    const sink = new mb.VideoSampleSink(vtrack);
    const motion = createMotion();
    let i = 0;
    for await (const sample of sink.samplesAtTimestamps(timestamps)) {
      if (signal.aborted) {
        sample?.close();
        throw new DOMException("cancelado", "AbortError");
      }
      const srcMs = srcTimes[i];
      comp.step(motion, srcMs, "spring");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      const image = sample ? sample.toCanvasImageSource() : null;
      comp.render(ctx, image, srcMs, motion);
      sample?.close();
      await videoSource.add(i / fps, 1 / fps);
      i++;
      if (i % 5 === 0) onProgress(audioShare + (1 - audioShare) * (i / frames), `Gerando o vídeo… ${Math.round((i / frames) * 100)}%`);
    }
    videoSource.close();
    onProgress(1, "Finalizando…");
    await output.finalize();
    ok = true;
  } catch (err) {
    if (output && output.state !== "finalized") await output.cancel().catch(() => {});
    throw err;
  } finally {
    input.dispose?.();
    await api.exportClose(target.id, ok);
  }
  return target.path;
}
