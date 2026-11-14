/**
 * Audio capture.
 * "mic" records the room through the microphone: in-person meetings, or a call playing on speakers.
 * "online" also captures the sound of a shared tab or screen (Teams, Zoom, or Meet in the browser)
 * and mixes it with the microphone, so both sides of the call are on the recording. Desktop browsers only.
 */
export type AudioSource = "mic" | "online";

export interface RecordingSession {
  /** Live input level, 0 to 1, for the meter. */
  level: () => number;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Blob>;
  cancel: () => void;
  mime: string;
}

export const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

export const canCaptureOnlineAudio = () =>
  canRecord() && typeof navigator.mediaDevices.getDisplayMedia === "function" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function describeCaptureError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Izin ditolak. Izinkan mikrofon (dan berbagi layar bila merekam rapat online) untuk situs ini, lalu coba lagi.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Mikrofon tidak ditemukan di perangkat ini.";
  if (name === "NotReadableError") return "Mikrofon sedang dipakai aplikasi lain. Tutup aplikasi itu, lalu coba lagi.";
  if (error instanceof Error && error.message) return error.message;
  return "Perekaman tidak bisa dimulai di perangkat ini.";
}

export async function startRecording(source: AudioSource): Promise<RecordingSession> {
  if (!canRecord()) throw new Error("Browser ini belum mendukung perekaman audio.");

  const streams: MediaStream[] = [];
  const stopAll = () => streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));

  try {
    let displayAudio: MediaStream | null = null;
    if (source === "online") {
      // The picker asks which tab, window, or screen to share. Sound is only included when the person
      // ticks "share audio", so check for an audio track and explain if it is missing.
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      streams.push(display);
      if (display.getAudioTracks().length === 0) {
        throw new Error(
          'Audio rapat tidak ikut dibagikan. Pilih tab rapat lalu centang "Bagikan audio tab" pada dialog berbagi layar.',
        );
      }
      display.getVideoTracks().forEach((track) => track.stop());
      displayAudio = new MediaStream(display.getAudioTracks());
    }

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streams.push(mic);

    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioCtx();
    if (context.state === "suspended") await context.resume();
    const destination = context.createMediaStreamDestination();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;

    const sources = [context.createMediaStreamSource(mic)];
    if (displayAudio) sources.push(context.createMediaStreamSource(displayAudio));
    for (const node of sources) {
      node.connect(destination);
      node.connect(analyser);
    }

    const mime = pickMime();
    const recorder = new MediaRecorder(destination.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(1000);

    const samples = new Uint8Array(analyser.fftSize);
    const teardown = () => {
      stopAll();
      void context.close().catch(() => undefined);
    };

    return {
      mime: recorder.mimeType || mime || "audio/webm",
      level: () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        return Math.min(1, peak / 96);
      },
      pause: () => {
        if (recorder.state === "recording") recorder.pause();
      },
      resume: () => {
        if (recorder.state === "paused") recorder.resume();
      },
      stop: () =>
        new Promise<Blob>((resolve) => {
          const finish = () => {
            teardown();
            resolve(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" }));
          };
          if (recorder.state === "inactive") {
            finish();
          } else {
            recorder.onstop = finish;
            recorder.stop();
          }
        }),
      cancel: () => {
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
        teardown();
      },
    };
  } catch (error) {
    stopAll();
    throw error;
  }
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}
