import { useSyncExternalStore } from "react";
import { extractAudio, isVideoFile } from "./audioExtract";
import { addAsset, appendSegments, replaceSourceSegments } from "./db";
import { engineTranscribe, getEngine } from "./engine";
import { getSettings } from "./settings";
import { transcribeAudio } from "./stt";
import { docxToText, fromTimedText, lastTimestamp, parseTranscript } from "./transcript";
import { uid, type Lang } from "./types";

/**
 * Imports live here, outside any screen, so changing tabs or opening another page never stops one.
 * A job keeps running until it finishes, fails, or the person cancels it.
 */

export interface ImportJob {
  id: string;
  meetingId: string;
  name: string;
  size: number;
  status: "working" | "done" | "failed" | "cancelled";
  /** What is happening right now, in words. */
  step: string;
  percent: number;
  error?: string;
  /** Size of the audio that was kept, when a video was reduced to its sound. */
  keptBytes?: number;
}

export interface ImportOptions {
  language: Lang;
  /** Reduce videos to their audio track before upload and storage. */
  audioOnly: boolean;
}

let jobs: ImportJob[] = [];
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();

function emit(next: ImportJob[]) {
  jobs = next;
  listeners.forEach((listener) => listener());
}

function patch(id: string, change: Partial<ImportJob>) {
  emit(jobs.map((job) => (job.id === id && job.status === "working" ? { ...job, ...change } : job)));
}

export function useImportJobs(meetingId: string): ImportJob[] {
  const all = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => jobs,
    () => jobs,
  );
  return all.filter((job) => job.meetingId === meetingId);
}

export function cancelImport(id: string) {
  controllers.get(id)?.abort();
}

export function clearImport(id: string) {
  emit(jobs.filter((job) => job.id !== id));
}

export function startImport(meetingId: string, file: File, options: ImportOptions): string {
  const id = uid();
  const controller = new AbortController();
  controllers.set(id, controller);
  emit([...jobs, { id, meetingId, name: file.name, size: file.size, status: "working", step: "Menyiapkan berkas", percent: 2 }]);
  void run(id, meetingId, file, options, controller.signal)
    .then(() => emit(jobs.map((job) => (job.id === id && job.status === "working" ? { ...job, status: "done", step: "Selesai", percent: 100 } : job))))
    .catch((error: unknown) => {
      const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      emit(
        jobs.map((job) =>
          job.id === id ? { ...job, status: cancelled ? "cancelled" : "failed", step: cancelled ? "Dibatalkan" : "Gagal", error: cancelled ? undefined : error instanceof Error ? error.message : "Impor gagal." } : job,
        ),
      );
    })
    .finally(() => controllers.delete(id));
  return id;
}

async function run(id: string, meetingId: string, file: File, options: ImportOptions, signal: AbortSignal): Promise<void> {
  const name = file.name.toLowerCase();

  if (/\.(vtt|srt|txt|md)$/.test(name) || file.type.startsWith("text/")) {
    const segments = parseTranscript(await file.text());
    if (segments.length === 0) throw new Error("Berkas ini tidak berisi teks yang bisa dibaca.");
    await appendSegments(meetingId, segments, lastTimestamp(segments));
    return;
  }

  if (name.endsWith(".docx")) {
    const segments = parseTranscript(await docxToText(await file.arrayBuffer()), { nameOnOwnLine: true });
    if (segments.length === 0) throw new Error("Dokumen ini tidak berisi teks yang bisa dibaca.");
    await appendSegments(meetingId, segments, lastTimestamp(segments));
    return;
  }

  const isMedia = file.type.startsWith("audio/") || file.type.startsWith("video/") || /\.(mp3|m4a|wav|mp4|m4v|webm|ogg|mov|mkv|aac|flac)$/.test(name);
  if (!isMedia) throw new Error("Jenis berkas ini belum didukung.");

  // Step 1: a video becomes its sound alone, which is a small fraction of the size.
  let source: Blob = file;
  let sourceName = file.name;
  let sourceMime = file.type || "audio/mpeg";
  let keptBytes: number | undefined;
  if (options.audioOnly && isVideoFile(file)) {
    patch(id, { step: "Mengambil audio dari video", percent: 3 });
    const extracted = await extractAudio(file, { signal, onProgress: (fraction) => patch(id, { percent: 3 + Math.round(fraction * 22) }) });
    if (extracted) {
      source = extracted.blob;
      sourceName = extracted.name;
      sourceMime = extracted.mime;
      keptBytes = extracted.blob.size;
      patch(id, { keptBytes });
    } else {
      patch(id, { step: "Browser ini tidak bisa memisahkan audio, memakai berkas aslinya" });
    }
  }
  if (signal.aborted) throw new DOMException("Dibatalkan", "AbortError");

  // Step 2: speech to text.
  let segments;
  let durationSec;
  const current = getEngine();
  if (current.state === "ready" && current.whisper) {
    patch(id, { step: "Mengirim ke mesin", percent: 26 });
    const result = await engineTranscribe(source, {
      language: options.language,
      signal,
      onProgress: (progress) => patch(id, progress.stage === "transcribe" ? { step: "Mengubah suara menjadi teks", percent: 30 + Math.round(progress.percent * 0.65) } : { step: "Menyiapkan audio di mesin", percent: 28 }),
    });
    segments = fromTimedText(result.segments);
    durationSec = result.durationSec;
  } else {
    const apiKey = getSettings().elevenLabsKey;
    if (!apiKey) throw new Error("Nyalakan mesin Notula di komputer untuk mentranskripsikan audio, atau isi kunci ElevenLabs di Pengaturan.");
    patch(id, { step: "Mengubah suara menjadi teks", percent: 30 });
    const result = await transcribeAudio(source, { apiKey, language: options.language, fileName: sourceName, signal });
    segments = result.segments;
    durationSec = result.durationSec;
  }
  if (segments.length === 0) throw new Error("Tidak ada ucapan yang terdeteksi di berkas ini.");

  patch(id, { step: "Menyimpan", percent: 97 });
  const asset = await addAsset({ meetingId, kind: "audio", name: sourceName, mime: sourceMime, blob: source, caption: "", width: 0, height: 0, offsetSec: 0 });
  await replaceSourceSegments(meetingId, asset.id, segments, durationSec);
}
