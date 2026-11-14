import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { formatDate, formatTimeRange } from "./format";
import { segmentsToText } from "./transcript";
import { PLATFORM_LABEL, type Lang, type Meeting, type Minutes } from "./types";

/**
 * Turns a transcript (plus any pictures from the meeting) into structured minutes with Claude.
 * The request goes straight from this browser to api.anthropic.com with the person's own API key.
 */

const MinutesSchema = z.object({
  title: z.string(),
  topic: z.string(),
  opening: z.string(),
  objectives: z.array(z.string()),
  discussion: z.array(z.object({ heading: z.string(), summary: z.string(), points: z.array(z.string()) })),
  decisions: z.array(z.string()),
  actionItems: z.array(z.object({ task: z.string(), owner: z.string(), due: z.string() })),
  summary: z.string(),
  attendees: z.array(z.object({ name: z.string(), role: z.string() })),
  imageCaptions: z.array(z.object({ index: z.number(), caption: z.string() })),
});

export type GeneratedMinutes = z.infer<typeof MinutesSchema>;

/** The same shape as MinutesSchema, spelled out as the JSON Schema that the API constrains output to. */
const text = { type: "string" } as const;
const list = (items: object) => ({ type: "array", items }) as const;
const object = (properties: Record<string, object>) =>
  ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }) as const;

const OUTPUT_SCHEMA = object({
  title: text,
  topic: text,
  opening: text,
  objectives: list(text),
  discussion: list(object({ heading: text, summary: text, points: list(text) })),
  decisions: list(text),
  actionItems: list(object({ task: text, owner: text, due: text })),
  summary: text,
  attendees: list(object({ name: text, role: text })),
  imageCaptions: list(object({ index: { type: "integer" }, caption: text })),
});

const LANGUAGE_NAME: Record<Lang, string> = { id: "Bahasa Indonesia", en: "English" };

function systemPrompt(language: Lang): string {
  return `You write the official minutes of a meeting from its transcript. The minutes are exported to Word, Excel, and PowerPoint and sent to the attendees and to people who were not in the room, so they must stand on their own: someone who missed the meeting should understand what was discussed, what was decided, and who does what next.

Write every field in ${LANGUAGE_NAME[language]}, in a clear, professional register, whatever language the transcript is in. Keep names, product names, and figures exactly as spoken.

Work only from the transcript, the meeting details, and the attached pictures. The transcript may come from automatic speech recognition, so expect misheard words, missing punctuation, and generic speaker labels such as "Pembicara 1"; read through those errors for the intended meaning, and do not carry obvious recognition mistakes into the minutes. Do not invent decisions, owners, dates, or attendees. When something is not stated, leave that field as an empty string or an empty list. A short or thin transcript should produce short minutes.

The fields:
- title: a short, specific title for the meeting. If the given title is already specific, return it unchanged.
- topic: the main subject of the meeting, in one sentence.
- opening: one short paragraph on how the meeting opened: who led it, the context, and what was put on the table.
- objectives: what the meeting set out to achieve, stated or clearly implied.
- discussion: the body of the minutes. One entry per agenda item or subject, in the order discussed. Each has a heading, a summary paragraph that explains the substance and the reasoning, and the key points as short standalone sentences. Attribute positions to the people who held them when the transcript makes that clear.
- decisions: what was agreed, one decision per item.
- actionItems: follow-ups with the task, the owner, and the due date as stated in the meeting. Leave owner or due empty when not mentioned.
- summary: a closing paragraph that recaps the outcome and the next steps.
- attendees: the people who took part. Start from the attendee list in the meeting details and add anyone else who clearly speaks or is addressed as present. Give the role when it is evident, otherwise an empty string. Do not list generic speaker labels as people.
- imageCaptions: one entry per attached picture, using its number, with a one-sentence caption that says what the picture shows and how it relates to the discussion. Return an empty list when no pictures are attached.`;
}

function meetingBrief(meeting: Meeting, imageCount: number): string {
  const known = meeting.attendees.filter((attendee) => attendee.name.trim());
  const lines = [
    `Title: ${meeting.title}`,
    `Date: ${formatDate(meeting.date)}`,
    `Time: ${formatTimeRange(meeting) || "not recorded"}`,
    `Held via: ${PLATFORM_LABEL[meeting.platform]}`,
    `Location or link: ${meeting.location || "not recorded"}`,
    `Chaired by: ${meeting.organizer || "not recorded"}`,
    `Attendee list entered so far: ${
      known.length > 0 ? known.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join("; ") : "none"
    }`,
    `Pictures attached: ${imageCount}`,
  ];
  return `<meeting_details>\n${lines.join("\n")}\n</meeting_details>\n\n<transcript>\n${segmentsToText(meeting.segments)}\n</transcript>\n\nWrite the minutes of this meeting.`;
}

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

/** Maps the model's answer onto the stored minutes shape. */
export function toMinutes(generated: GeneratedMinutes, model: string): Minutes {
  const clean = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);
  return {
    topic: generated.topic.trim(),
    opening: generated.opening.trim(),
    objectives: clean(generated.objectives),
    discussion: generated.discussion
      .map((item) => ({ heading: item.heading.trim(), summary: item.summary.trim(), points: clean(item.points) }))
      .filter((item) => item.heading || item.summary || item.points.length > 0),
    decisions: clean(generated.decisions),
    actionItems: generated.actionItems
      .map((item) => ({ task: item.task.trim(), owner: item.owner.trim(), due: item.due.trim() }))
      .filter((item) => item.task),
    summary: generated.summary.trim(),
    generatedAt: Date.now(),
    source: "ai",
    model,
  };
}
