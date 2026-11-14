/**
 * Cuts a running audio stream into short pieces for live transcription.
 *
 * Speech recognition wants whole phrases, so a cut is made at a pause once a piece is long enough,
 * and only forced when someone talks without stopping. Pieces that hold no sound at all are dropped:
 * a speech model handed silence tends to invent words.
 */

export const TARGET_RATE = 16_000;

export interface AudioChunk {
  /** 16 kHz mono 16-bit WAV. */
  wav: Blob;
  /** Position of this piece in the recording, in seconds. */
  startSec: number;
  endSec: number;
}

export interface ChunkerOptions {
  /** A cut at a pause is allowed once the piece is this long. */
  minSeconds?: number;
  /** A piece is cut at this length even without a pause. */
  maxSeconds?: number;
  /** How long a pause must last to count, in milliseconds. */
  pauseMs?: number;
  /** Level below which a frame counts as a pause, 0 to 1. */
  quietLevel?: number;
  /** A piece whose loudest sample is below this is treated as silence and dropped. */
  silencePeak?: number;
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/** Averages groups of samples down to 16 kHz. Averaging doubles as the low-pass filter. */
export function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return input;
  const ratio = fromRate / TARGET_RATE;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.max(from + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += input[j];
    output[i] = sum / (to - from);
  }
  return output;
}

export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class LiveChunker {
  private frames: Float32Array[] = [];
  private buffered = 0;
  private emitted = 0;
  private quietSamples = 0;
  private readonly min: number;
  private readonly max: number;
  private readonly pause: number;
  private readonly quietLevel: number;
  private readonly silencePeak: number;

  constructor(
    private readonly sampleRate: number,
    private readonly onChunk: (chunk: AudioChunk) => void,
    options: ChunkerOptions = {},
  ) {
    this.min = (options.minSeconds ?? 7) * sampleRate;
    this.max = (options.maxSeconds ?? 15) * sampleRate;
    this.pause = ((options.pauseMs ?? 350) / 1000) * sampleRate;
    this.quietLevel = options.quietLevel ?? 0.01;
    this.silencePeak = options.silencePeak ?? 0.02;
  }

  /** Feed mono samples at the source rate, in order. */
  push(frame: Float32Array): void {
    this.frames.push(frame);
    this.buffered += frame.length;
    this.quietSamples = rms(frame) < this.quietLevel ? this.quietSamples + frame.length : 0;
    const atPause = this.buffered >= this.min && this.quietSamples >= this.pause;
    if (atPause || this.buffered >= this.max) this.cut();
  }

  /** Sends whatever is left, at the end of a recording. */
  flush(): void {
    if (this.buffered > this.sampleRate * 0.4) this.cut();
    else this.reset();
  }

  private reset() {
    this.emitted += this.buffered;
    this.frames = [];
    this.buffered = 0;
    this.quietSamples = 0;
  }

  private cut() {
    const joined = new Float32Array(this.buffered);
    let offset = 0;
    let peak = 0;
    for (const frame of this.frames) {
      joined.set(frame, offset);
      offset += frame.length;
      for (let i = 0; i < frame.length; i += 1) {
        const level = Math.abs(frame[i]);
        if (level > peak) peak = level;
      }
    }
    const startSec = this.emitted / this.sampleRate;
    const endSec = (this.emitted + this.buffered) / this.sampleRate;
    this.reset();
    if (peak < this.silencePeak) return;
    this.onChunk({ wav: encodeWav(downsample(joined, this.sampleRate)), startSec, endSec });
  }
}

const WORKLET_SOURCE = `
class NotulaPcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const left = input[0];
      const right = input[1];
      for (let i = 0; i < left.length; i += 1) {
        this.buffer[this.filled++] = right ? (left[i] + right[i]) * 0.5 : left[i];
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("notula-pcm-tap", NotulaPcmTap);
`;

/**
 * Hands the raw samples flowing through `sources` to `onFrame`, without changing what is heard or
 * recorded. Returns a function that stops the tap.
 */
export async function tapPcm(context: AudioContext, sources: AudioNode[], onFrame: (frame: Float32Array) => void): Promise<() => void> {
  // A silent path to the output keeps the browser pulling audio through the tap.
  const sink = context.createGain();
  sink.gain.value = 0;
  sink.connect(context.destination);

  if (context.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(context, "notula-pcm-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: "max" });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
      sources.forEach((source) => source.connect(node));
      node.connect(sink);
      return () => {
        node.port.onmessage = null;
        node.disconnect();
        sink.disconnect();
      };
    } catch {
      // Fall back to the older node below.
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const node = context.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (event) => onFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
  sources.forEach((source) => source.connect(node));
  node.connect(sink);
  return () => {
    node.onaudioprocess = null;
    node.disconnect();
    sink.disconnect();
  };
}
