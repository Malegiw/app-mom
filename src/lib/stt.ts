import { uid, type Lang, type Segment } from "./types";

/**
 * Speech to text for recorded or imported audio, through ElevenLabs Scribe.
 * Scribe labels who is speaking (diarization), which is what turns a recording into usable minutes.
 * Docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const MODEL = "scribe_v2";

interface ScribeWord {
  text: string;
  type: "word" | "spacing" | "audio_event";
  start?: number;
  end?: number;
  speaker_id?: string | null;
}

interface ScribeResponse {
  language_code: string;
  text: string;
  words: ScribeWord[];
  audio_duration_secs?: number;
}

export interface TranscriptionResult {
  segments: Segment[];
  durationSec: number;
  language: string;
}

export class TranscriptionError extends Error {}

export async function transcribeAudio(
  audio: Blob,
  options: { apiKey: string; language: Lang | "auto"; fileName: string; signal?: AbortSignal },
): Promise<TranscriptionResult> {
  if (!options.apiKey) throw new TranscriptionError("Kunci API ElevenLabs belum diisi di Pengaturan.");

  const form = new FormData();
  form.append("file", audio, options.fileName);
  form.append("model_id", MODEL);
  form.append("diarize", "true");
  form.append("tag_audio_events", "false");
  form.append("timestamps_granularity", "word");
  if (options.language !== "auto") form.append("language_code", options.language);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": options.apiKey },
      body: form,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new TranscriptionError("Tidak bisa menghubungi layanan transkripsi. Periksa koneksi internet, lalu coba lagi.");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: { message?: string } | string | { msg?: string }[] };
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((item) => item.msg).filter(Boolean).join("; ");
      else detail = body.detail?.message ?? "";
    } catch {
      // The body was not JSON. The status code below is enough.
    }
    if (response.status === 401) throw new TranscriptionError("Kunci API ElevenLabs tidak valid. Periksa kembali di Pengaturan.");
    if (response.status === 413) throw new TranscriptionError("Berkas audio terlalu besar untuk layanan transkripsi.");
    if (response.status === 429) throw new TranscriptionError("Kuota atau batas permintaan ElevenLabs tercapai. Coba lagi beberapa saat lagi.");
    throw new TranscriptionError(`Transkripsi gagal (${response.status}). ${detail}`.trim());
  }

  const data = (await response.json()) as ScribeResponse;
  const segments = wordsToSegments(data.words ?? []);
  const lastEnd = [...(data.words ?? [])].reverse().find((word) => typeof word.end === "number")?.end ?? 0;
  return {
    segments: segments.length > 0 || !data.text ? segments : [{ id: uid(), start: 0, speaker: "", text: data.text.trim() }],
    durationSec: Math.round(data.audio_duration_secs ?? lastEnd),
    language: data.language_code,
  };
}

/** Groups word timings into speaker turns, starting a new paragraph on a speaker change or a long pause. */
export function wordsToSegments(words: ScribeWord[], maxChars = 700, pauseSeconds = 2.5): Segment[] {
  const speakerLabels = new Map<string, string>();
  const labelFor = (id: string | null | undefined) => {
    if (!id) return "";
    if (!speakerLabels.has(id)) speakerLabels.set(id, `Pembicara ${speakerLabels.size + 1}`);
    return speakerLabels.get(id)!;
  };

  const segments: Segment[] = [];
  let current: { speakerId: string; start: number | null; text: string; lastEnd: number } | null = null;

  const push = () => {
    if (current && current.text.trim()) {
      segments.push({ id: uid(), start: current.start, speaker: labelFor(current.speakerId), text: current.text.replace(/\s+/g, " ").trim() });
    }
    current = null;
  };

  for (const word of words) {
    if (word.type === "audio_event") continue;
    if (word.type === "spacing") {
      if (current) current.text += " ";
      continue;
    }
    const speakerId = word.speaker_id ?? "";
    const start = typeof word.start === "number" ? word.start : null;
    const endsSentence = current ? /[.!?]\s*$/.test(current.text) : false;
    const pausedLong = current !== null && start !== null && start - current.lastEnd > pauseSeconds && endsSentence;
    const tooLong = current !== null && current.text.length > maxChars && endsSentence;
    if (current && (current.speakerId !== speakerId || pausedLong || tooLong)) push();
    if (!current) current = { speakerId, start, text: "", lastEnd: start ?? 0 };
    current.text += word.text;
    if (typeof word.end === "number") current.lastEnd = word.end;
  }
  push();
  return segments;
}
