import { tapPcm } from "./liveAudio";

/**
 * Audio capture.
 * "mic" records the room through the microphone: in-person meetings, or a call playing on speakers.
 * "online" also captures the sound of a shared tab, window, or screen (Teams, Zoom, Meet, YouTube)
 * and mixes it with the microphone, so both sides of a call are on the recording.
 * "system" captures only that shared sound, for listening to a video or webinar without the room.
 * The last two need a desktop browser.
 */
export type AudioSource = "mic" | "online" | "system";

export interface RecordingOptions {
  /** Receives the raw mixed samples as they arrive, for live transcription. */
  onPcm?: (frame: Float32Array) => void;
  /** Called when the person ends the share from the browser's own "stop sharing" control. */
  onEnded?: () => void;
}

export interface RecordingSession {
  /** Live input level, 0 to 1, for the meter. */
  level: () => number;
  /** Sample rate of the frames passed to `onPcm`. */
  sampleRate: number;
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
    return "Izin ditolak. Izinkan mikrofon (dan berbagi layar bila mendengarkan rapat online) untuk situs ini, lalu coba lagi.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Mikrofon tidak ditemukan di perangkat ini.";
  if (name === "NotReadableError") return "Mikrofon sedang dipakai aplikasi lain. Tutup aplikasi itu, lalu coba lagi.";
  if (error instanceof Error && error.message) return error.message;
  return "Perekaman tidak bisa dimulai di perangkat ini.";
}

/** Asks the browser for the sound of a tab, window, or screen. */
async function captureSharedAudio(): Promise<MediaStream> {
  // The hints ask Chrome to offer system sound for windows and screens, not just tabs. Browsers that
  // do not know a hint ignore it.
  const options = {
    video: { frameRate: 1 },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    systemAudio: "include",
    windowAudio: "system",
    selfBrowserSurface: "exclude",
  } as DisplayMediaStreamOptions;
  const display = await navigator.mediaDevices.getDisplayMedia(options);
  if (display.getAudioTracks().length === 0) {
    display.getTracks().forEach((track) => track.stop());
    throw new Error('Suaranya tidak ikut dibagikan. Ulangi, lalu nyalakan "Bagikan audio" pada dialog berbagi. Untuk aplikasi Teams atau Zoom, pilih Seluruh layar.');
  }
  return display;
}

export async function startRecording(source: AudioSource, options: RecordingOptions = {}): Promise<RecordingSession> {
  if (!canRecord()) throw new Error("Browser ini belum mendukung perekaman audio.");

  const streams: MediaStream[] = [];
  const stopAll = () => streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));

  try {
    const inputs: MediaStream[] = [];
    if (source !== "mic") {
      const display = await captureSharedAudio();
      streams.push(display);
      // The picture is not used, but its track stays alive: ending it can end the shared sound with it.
      display.getAudioTracks().forEach((track) => track.addEventListener("ended", () => options.onEnded?.(), { once: true }));
      inputs.push(new MediaStream(display.getAudioTracks()));
    }
    if (source !== "system") {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streams.push(mic);
      inputs.push(mic);
    }

    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioCtx();
    if (context.state === "suspended") await context.resume();
    const destination = context.createMediaStreamDestination();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;

    const nodes = inputs.map((stream) => context.createMediaStreamSource(stream));
    for (const node of nodes) {
      node.connect(destination);
      node.connect(analyser);
    }
    const untap = options.onPcm ? await tapPcm(context, nodes, options.onPcm) : null;

    const mime = pickMime();
    const recorder = new MediaRecorder(destination.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(1000);

    const samples = new Uint8Array(analyser.fftSize);
    const teardown = () => {
      untap?.();
      stopAll();
      void context.close().catch(() => undefined);
    };

    return {
      mime: recorder.mimeType || mime || "audio/webm",
      sampleRate: context.sampleRate,
      level: () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        return Math.min(1, peak / 96);
      },
      pause: () => {
        if (recorder.state === "recording") recorder.pause();
        void context.suspend();
      },
      resume: () => {
        void context.resume();
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
