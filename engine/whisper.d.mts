export interface TimedText {
  start: number;
  end: number;
  text: string;
}
export function cleanSegments(segments: TimedText[]): TimedText[];
export function whisperStatus(): { ready: boolean; installed: boolean; model: boolean; ffmpeg: boolean };
export function warmUp(): Promise<void>;
export function transcribeFile(
  inputPath: string,
  options?: { language?: string; prompt?: string; isWav16k?: boolean; signal?: AbortSignal; onProgress?: (progress: { stage: string; percent: number }) => void },
): Promise<{ segments: TimedText[]; durationSec: number; language?: string }>;
