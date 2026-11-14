import { describe, expect, it } from "vitest";
import { cleanSegments } from "../engine/whisper.mjs";
import { modelDisplayName } from "../src/lib/engine";
import { downsample, encodeWav, LiveChunker, type AudioChunk } from "../src/lib/liveAudio";
import { MinutesWithVisualsSchema, outputJsonSchema, systemPrompt } from "../src/lib/minutesPrompt";
import { fromTimedText } from "../src/lib/transcript";

const RATE = 48_000;
/** `seconds` of a steady tone at the given loudness, or of silence when the level is 0. */
function tone(seconds: number, level: number): Float32Array {
  const frame = new Float32Array(Math.round(seconds * RATE));
  if (level > 0) for (let i = 0; i < frame.length; i += 1) frame[i] = Math.sin(i / 20) * level;
  return frame;
}
/** Feeds audio the way the browser does, in small frames. */
function feed(chunker: LiveChunker, audio: Float32Array, frameSize = 4096) {
  for (let i = 0; i < audio.length; i += frameSize) chunker.push(audio.subarray(i, Math.min(audio.length, i + frameSize)));
}

describe("LiveChunker", () => {
  it("cuts at a pause once a piece is long enough, and keeps the timeline exact", () => {
    const chunks: AudioChunk[] = [];
    const chunker = new LiveChunker(RATE, (chunk) => chunks.push(chunk));
    feed(chunker, tone(9, 0.3)); // speech
    feed(chunker, tone(1, 0)); // a pause
    feed(chunker, tone(5, 0.3)); // more speech
    chunker.flush();
    expect(chunks).toHaveLength(2);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[0].endSec).toBeGreaterThan(9);
    expect(chunks[0].endSec).toBeLessThan(10);
    expect(chunks[1].startSec).toBeCloseTo(chunks[0].endSec, 5);
    expect(chunks[1].endSec).toBeCloseTo(15, 1);
  });

  it("forces a cut when someone talks without pausing", () => {
    const chunks: AudioChunk[] = [];
    const chunker = new LiveChunker(RATE, (chunk) => chunks.push(chunk));
    feed(chunker, tone(32, 0.3));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].endSec - chunks[0].startSec).toBeCloseTo(15, 0);
  });

  it("drops silence instead of sending it to the speech model", () => {
    const chunks: AudioChunk[] = [];
    const chunker = new LiveChunker(RATE, (chunk) => chunks.push(chunk));
    feed(chunker, tone(20, 0));
    feed(chunker, tone(8, 0.3));
    chunker.flush();
    // Two fully silent pieces (0 to 7 s and 7 to 14 s) are dropped. The third holds the speech.
    expect(chunks).toHaveLength(1);
    // The dropped stretch still counts on the clock, so the words land at the right time.
    expect(chunks[0].startSec).toBeCloseTo(14, 0);
    expect(chunks[0].endSec).toBeCloseTo(28, 0);
  });

  it("produces 16 kHz mono WAV", async () => {
    const samples = downsample(tone(1, 0.5), RATE);
    expect(samples.length).toBe(16_000);
    const wav = encodeWav(samples);
    const view = new DataView(await wav.arrayBuffer());
    expect(wav.size).toBe(44 + 16_000 * 2);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
  });
});

describe("engine text handling", () => {
  it("removes bracketed sounds and invented sign-offs", () => {
    const kept = cleanSegments([
      { start: 0, end: 1, text: " [BLANK_AUDIO]" },
      { start: 1, end: 2, text: " (musik)" },
      { start: 2, end: 5, text: " Kita mulai rapatnya." },
    ]);
    expect(kept).toEqual([{ start: 2, end: 5, text: "Kita mulai rapatnya." }]);
    expect(cleanSegments([{ start: 0, end: 2, text: "Terima kasih telah menonton." }])).toEqual([]);
    // A real thank-you inside a meeting stays.
    expect(cleanSegments([{ start: 0, end: 2, text: "Terima kasih semuanya." }])).toHaveLength(1);
  });

  it("turns timed text into transcript paragraphs with an offset", () => {
    const segments = fromTimedText([{ start: 0, text: " Selamat pagi." }, { start: 4.2, text: "Kita mulai." }, { start: 9, text: "  " }], 60);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 60, speaker: "", text: "Selamat pagi. Kita mulai." });
  });

  it("names models for display", () => {
    expect(modelDisplayName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelDisplayName("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelDisplayName("claude.ai")).toBe("Claude");
    expect(modelDisplayName("")).toBe("Claude");
  });
});

describe("minutes with pictures", () => {
  it("asks for pictures only when wanted", () => {
    const plain = outputJsonSchema(false) as { properties: Record<string, unknown>; required: string[] };
    const withVisuals = outputJsonSchema(true) as { properties: Record<string, unknown>; required: string[] };
    expect(plain.properties.visuals).toBeUndefined();
    expect(withVisuals.required).toContain("visuals");
    expect(systemPrompt("id")).not.toContain("svg");
    expect(systemPrompt("id", true)).toContain('viewBox="0 0 1600 900"');
    expect(systemPrompt("en", true)).toContain("Write every label in English");
  });

  it("accepts an answer whose pictures are missing or malformed", () => {
    const base = { title: "", topic: "t", opening: "", objectives: [], discussion: [], decisions: [], actionItems: [], summary: "", attendees: [], imageCaptions: [] };
    expect(MinutesWithVisualsSchema.parse(base).visuals).toEqual([]);
    expect(MinutesWithVisualsSchema.parse({ ...base, visuals: "tidak ada" }).visuals).toEqual([]);
    expect(MinutesWithVisualsSchema.parse({ ...base, visuals: [{ title: "Alur", caption: "c", svg: "<svg/>" }] }).visuals).toHaveLength(1);
  });
});
