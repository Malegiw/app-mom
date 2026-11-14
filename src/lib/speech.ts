import type { Lang } from "./types";

/**
 * Live captions through the browser's built-in speech recognition (Chrome, Edge, Safari).
 * It listens to the microphone only, costs nothing, and needs a network connection in most browsers.
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => getCtor() !== null;

export const SPEECH_LOCALE: Record<Lang, string> = { id: "id-ID", en: "en-US" };

export interface LiveTranscriberHandlers {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (message: string) => void;
}

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Izin mikrofon ditolak. Izinkan mikrofon untuk situs ini di pengaturan browser, lalu coba lagi.",
  "service-not-allowed": "Browser ini memblokir layanan transkripsi langsung. Coba Chrome, Edge, atau Safari.",
  "audio-capture": "Mikrofon tidak ditemukan atau sedang dipakai aplikasi lain.",
  network: "Transkripsi langsung butuh koneksi internet. Rekaman audio tetap berjalan.",
  "language-not-supported": "Bahasa ini belum didukung transkripsi langsung di browser ini.",
};

export class LiveTranscriber {
  private recognition: Recognition | null = null;
  private active = false;
  private restartTimer: number | undefined;

  constructor(
    private readonly lang: Lang,
    private readonly handlers: LiveTranscriberHandlers,
  ) {}

  start(): boolean {
    const Ctor = getCtor();
    if (!Ctor) return false;
    this.active = true;
    this.spawn(Ctor);
    return true;
  }

  private spawn(Ctor: RecognitionCtor) {
    const recognition = new Ctor();
    recognition.lang = SPEECH_LOCALE[this.lang];
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) this.handlers.onFinal(text);
        else interim += `${text} `;
      }
      this.handlers.onInterim(interim.trim());
    };

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are part of normal operation: the engine simply restarts.
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.handlers.onError(ERROR_TEXT[event.error] ?? `Transkripsi langsung berhenti (${event.error}).`);
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        this.active = false;
      }
    };

    // Browsers end a session after a pause or a time limit. While recording, start a fresh one.
    recognition.onend = () => {
      this.handlers.onInterim("");
      if (!this.active) return;
      this.restartTimer = window.setTimeout(() => {
        if (this.active) this.spawn(Ctor);
      }, 250);
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws when a session is already running; the next onend restarts it.
    }
  }

  stop() {
    this.active = false;
    window.clearTimeout(this.restartTimer);
    try {
      this.recognition?.stop();
    } catch {
      // Already stopped.
    }
    this.recognition = null;
  }
}
