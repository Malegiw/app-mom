import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { childPath, findBinary, MODEL_PATH } from "./config.mjs";

/**
 * Speech to text on this machine with whisper.cpp. Nothing leaves the computer and no key is needed.
 * Audio that is not already 16 kHz mono WAV goes through ffmpeg first.
 */

export function whisperStatus() {
  const bin = findBinary("whisper-cli");
  const model = existsSync(MODEL_PATH);
  return { ready: Boolean(bin && model), installed: Boolean(bin), model, ffmpeg: Boolean(findBinary("ffmpeg")) };
}

function run(command, args, { signal, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, PATH: childPath() }, stdio: ["ignore", "ignore", "pipe"] });
    let tail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      tail = (tail + chunk).slice(-2000);
      onStderr?.(chunk);
    });
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(Object.assign(new Error("Dibatalkan."), { code: "aborted" }));
      else if (code === 0) resolve();
      else reject(new Error(`${command.split("/").pop()} berhenti dengan kode ${code}. ${tail.trim().split("\n").slice(-2).join(" ")}`));
    });
  });
}

// One job at a time: the speech model fills the GPU, and running two side by side makes both slower.
let queue = Promise.resolve();
function enqueue(job) {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

/** Sounds the model writes out in brackets, and the sign-offs it invents over silence. */
const NON_SPEECH = /^[\s\[(*♪]*(blank_audio|musik|music|suara musik|tepuk tangan|applause|tertawa|laughter|silence|hening|no speech)[\s\])*♪.]*$/i;
const BRACKET_ONLY = /^\s*[\[(][^\])]*[\])]\s*$/;
const INVENTED = /^\s*(terima kasih( telah| sudah)? (menonton|menyaksikan)|thanks? (you )?for watching|subtitles? by|sub(title)? indo|sampai jumpa di video)/i;

export function cleanSegments(segments) {
  const kept = segments
    .map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, " ").trim() }))
    .filter((segment) => segment.text && !NON_SPEECH.test(segment.text) && !BRACKET_ONLY.test(segment.text));
  // A result that is nothing but a video sign-off is the model filling a quiet stretch.
  if (kept.length > 0 && kept.every((segment) => INVENTED.test(segment.text))) return [];
  return kept;
}

/**
 * Transcribes one audio or video file.
 * `prompt` carries the last words already transcribed, which keeps names and terms consistent
 * from one live chunk to the next.
 */
export function transcribeFile(inputPath, { language = "id", prompt = "", isWav16k = false, signal, onProgress } = {}) {
  return enqueue(async () => {
    const whisper = findBinary("whisper-cli");
    if (!whisper) throw Object.assign(new Error("whisper.cpp belum terpasang di komputer ini. Jalankan: brew install whisper-cpp"), { code: "whisper_missing" });
    if (!existsSync(MODEL_PATH)) throw Object.assign(new Error("Model Whisper belum diunduh."), { code: "model_missing" });

    const wavPath = isWav16k ? inputPath : `${inputPath}.16k.wav`;
    const outBase = `${inputPath}.out`;
    try {
      if (!isWav16k) {
        const ffmpeg = findBinary("ffmpeg");
        if (!ffmpeg) throw Object.assign(new Error("ffmpeg belum terpasang, jadi berkas ini tidak bisa dibaca. Jalankan: brew install ffmpeg"), { code: "ffmpeg_missing" });
        onProgress?.({ stage: "convert", percent: 0 });
        await run(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath], { signal });
      }

      const { size } = await stat(wavPath);
      const durationSec = Math.max(0, (size - 44) / 32000);
      if (durationSec < 0.2) return { segments: [], durationSec };

      const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));
      const args = ["-m", MODEL_PATH, "-f", wavPath, "-l", language, "-oj", "-of", outBase, "-t", threads, "-sns", "-pp"];
      if (prompt) args.push("--prompt", prompt.slice(-400));
      onProgress?.({ stage: "transcribe", percent: 0 });
      await run(whisper, args, {
        signal,
        onStderr: (chunk) => {
          const match = /progress\s*=\s*(\d+)%/.exec(chunk);
          if (match) onProgress?.({ stage: "transcribe", percent: Number(match[1]) });
        },
      });

      const parsed = JSON.parse(await readFile(`${outBase}.json`, "utf8"));
      const segments = cleanSegments(
        (parsed.transcription ?? []).map((item) => ({
          start: (item.offsets?.from ?? 0) / 1000,
          end: (item.offsets?.to ?? 0) / 1000,
          text: String(item.text ?? ""),
        })),
      );
      return { segments, durationSec, language: parsed.result?.language ?? language };
    } finally {
      await Promise.all([`${outBase}.json`, ...(isWav16k ? [] : [wavPath])].map((file) => rm(file, { force: true })));
    }
  });
}

/**
 * The first transcription after a start is slow, because the model has to be read from disk and
 * prepared for the GPU. Running one second of silence up front moves that wait out of the meeting.
 */
export async function warmUp() {
  if (!whisperStatus().ready) return;
  const file = path.join(os.tmpdir(), `notula-warm-${process.pid}.wav`);
  const header = Buffer.alloc(44);
  const samples = 16000;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);
  try {
    await writeFile(file, Buffer.concat([header, Buffer.alloc(samples * 2)]));
    await transcribeFile(file, { isWav16k: true });
  } catch {
    // Warming up is a courtesy. A failure here shows up properly on the first real request.
  } finally {
    await rm(file, { force: true });
  }
}
