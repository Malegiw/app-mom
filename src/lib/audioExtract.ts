import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat, canEncodeAudio } from "mediabunny";

/**
 * Meeting recordings are mostly picture. Whisper only needs the voices, so a 250 MB Teams video
 * becomes a few megabytes of speech before it is uploaded or stored. Everything happens in the
 * browser, reading the file in pieces, so even a very large file never has to fit in memory.
 */

export interface ExtractedAudio {
  blob: Blob;
  name: string;
  mime: string;
}

const VIDEO_NAME = /\.(mp4|m4v|mov|mkv|webm)$/i;

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || VIDEO_NAME.test(file.name);
}

/**
 * Returns the audio track alone as a small file, or null when this browser cannot do it
 * (the caller then sends the original). The track is mixed to mono at a speech bitrate.
 */
export async function extractAudio(file: File, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<ExtractedAudio | null> {
  try {
    const useAac = await canEncodeAudio("aac");
    const useOpus = !useAac && (await canEncodeAudio("opus"));
    if (!useAac && !useOpus) return null;

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({ format: useAac ? new Mp4OutputFormat() : new WebMOutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: { codec: useAac ? "aac" : "opus", bitrate: 48_000, numberOfChannels: 1, sampleRate: 16_000 },
    });
    if (!conversion.isValid) return null;
    conversion.onProgress = (fraction: number) => options.onProgress?.(fraction);
    const abort = () => void conversion.cancel();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      await conversion.execute();
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
    if (options.signal?.aborted) throw new DOMException("Dibatalkan", "AbortError");

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) return null;
    const mime = useAac ? "audio/mp4" : "audio/webm";
    const base = file.name.replace(/\.[^.]+$/, "") || "rekaman";
    return { blob: new Blob([buffer], { type: mime }), name: `${base}.${useAac ? "m4a" : "webm"}`, mime };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (options.signal?.aborted) throw new DOMException("Dibatalkan", "AbortError");
    console.warn("[notula] audio extraction failed", error);
    return null;
  }
}
