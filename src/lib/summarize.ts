import Anthropic from "@anthropic-ai/sdk";
import { meetingBrief, MinutesSchema, outputJsonSchema, systemPrompt, toMinutes, type GeneratedMinutes } from "./minutesPrompt";
import type { Lang, Meeting } from "./types";

/**
 * Turns a transcript (plus any pictures from the meeting) into structured minutes with Claude.
 * The request goes straight from this browser to api.anthropic.com with the person's own API key.
 */

export { toMinutes };
export type { GeneratedMinutes };

const OUTPUT_SCHEMA = outputJsonSchema(false);

export interface ModelImage {
  /** Base64 JPEG data, without the data URL prefix. */
  base64: string;
}

export interface GenerateOptions {
  apiKey: string;
  model: string;
  language: Lang;
  meeting: Meeting;
  images: ModelImage[];
  signal?: AbortSignal;
  /** Called with the number of characters written so far, to show that work is progressing. */
  onProgress?: (characters: number) => void;
}

export class SummaryError extends Error {}

export async function generateMinutes(options: GenerateOptions): Promise<GeneratedMinutes> {
  const { apiKey, model, language, meeting, images, signal, onProgress } = options;
  if (!apiKey) throw new SummaryError("Kunci API Claude belum diisi di Pengaturan.");
  if (meeting.segments.length === 0) throw new SummaryError("Transkrip masih kosong. Rekam, impor, atau tempel transkrip lebih dulu.");

  // The key belongs to the person using this device and never leaves it except to reach Anthropic,
  // which is what makes a direct browser call acceptable here.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  images.forEach((image, index) => {
    content.push({ type: "text", text: `Picture ${index + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.base64 } });
  });
  content.push({ type: "text", text: meetingBrief(meeting, images.length) });

  // Haiku has no server-side fallback; the other models retry a declined request on a fallback model.
  const supportsFallback = !model.startsWith("claude-haiku");

  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 32000,
        system: systemPrompt(language),
        messages: [{ role: "user", content }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );
    if (onProgress) stream.on("text", (_delta, snapshot) => onProgress(snapshot.length));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new SummaryError("Claude menolak memproses rapat ini. Periksa isi transkrip, lalu coba lagi.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new SummaryError("Notulen terpotong karena terlalu panjang. Coba ringkas transkrip atau bagi rapat menjadi dua.");
    }

    const json = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    const parsed = MinutesSchema.safeParse(JSON.parse(json));
    if (!parsed.success) throw new SummaryError("Jawaban Claude tidak sesuai format notulen. Coba buat ulang.");
    return parsed.data;
  } catch (error) {
    if (error instanceof SummaryError) throw error;
    if (error instanceof Anthropic.APIUserAbortError) throw error;
    if (error instanceof Anthropic.AuthenticationError) {
      throw new SummaryError("Kunci API Claude tidak valid. Periksa kembali di Pengaturan.");
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      throw new SummaryError("Kunci API ini tidak punya akses ke model yang dipilih. Pilih model lain di Pengaturan.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new SummaryError("Batas permintaan Claude tercapai. Tunggu sebentar, lalu coba lagi.");
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new SummaryError(`Permintaan ditolak oleh Claude: ${error.message}`);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new SummaryError("Tidak bisa menghubungi Claude. Periksa koneksi internet, lalu coba lagi.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new SummaryError(`Claude sedang bermasalah (${error.status ?? "tanpa kode"}). Coba lagi beberapa saat lagi.`);
    }
    if (error instanceof SyntaxError) throw new SummaryError("Jawaban Claude tidak lengkap. Coba buat ulang.");
    throw error;
  }
}
