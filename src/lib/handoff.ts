import { z } from "zod";
import { meetingBrief, systemPrompt, type GeneratedMinutesWithVisuals } from "./minutesPrompt";
import type { Lang, Meeting } from "./types";

/**
 * The subscription path. Claude subscriptions (Pro, Max) cannot be used by an app through the API,
 * so Notula prepares one prompt, the person pastes it into claude.ai under their own plan, and then
 * pastes Claude's reply back here. Nothing is sent from this app and no API key or extra credit is used.
 */

const text = z.string().default("");
const lenient = z.object({
  title: text,
  topic: text,
  opening: text,
  objectives: z.array(z.string()).default([]),
  discussion: z.array(z.object({ heading: text, summary: text, points: z.array(z.string()).default([]) })).default([]),
  decisions: z.array(z.string()).default([]),
  actionItems: z.array(z.object({ task: text, owner: text, due: text })).default([]),
  summary: text,
  attendees: z.array(z.object({ name: text, role: text })).default([]),
  imageCaptions: z.array(z.object({ index: z.number(), caption: text })).default([]),
  visuals: z.array(z.object({ title: text, caption: text, svg: text })).catch([]),
});

const REPLY_FORMAT = `Reply with a single JSON object and nothing else: no introduction, no closing remark. Put it in one code block so it can be copied in one step. Use exactly these keys; every key must be present:

{
  "title": "",
  "topic": "",
  "opening": "",
  "objectives": [""],
  "discussion": [{ "heading": "", "summary": "", "points": [""] }],
  "decisions": [""],
  "actionItems": [{ "task": "", "owner": "", "due": "" }],
  "summary": "",
  "attendees": [{ "name": "", "role": "" }],
  "imageCaptions": [],
  "visuals": [{ "title": "", "caption": "", "svg": "" }]
}

No pictures are attached in this conversation, so "imageCaptions" must be an empty list. Inside the JSON, write every SVG attribute value with single quotes (for example <rect fill='#0F4C81'/>) and put each SVG on one line, so the JSON stays valid.`;

export class HandoffError extends Error {}

/** One message to paste into claude.ai: the instructions, the meeting, and how to answer. */
export function buildHandoffPrompt(meeting: Meeting, language: Lang): string {
  if (meeting.segments.length === 0) throw new HandoffError("Transkrip masih kosong. Rekam, impor, atau tempel transkrip lebih dulu.");
  return `${systemPrompt(language, true)}\n\n${REPLY_FORMAT}\n\n${meetingBrief(meeting, 0)}`;
}

/** Finds the JSON object in whatever the person pasted: a bare object, a code block, or text around it. */
function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

export function parseHandoffReply(raw: string): GeneratedMinutesWithVisuals {
  if (!raw.trim()) throw new HandoffError("Tempel jawaban Claude di kolom itu lebih dulu.");
  const json = extractJson(raw);
  if (!json) throw new HandoffError("Tidak ada data notulen di teks itu. Salin seluruh jawaban Claude, termasuk tanda kurung kurawal di awal dan akhir.");
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new HandoffError("Jawaban Claude terpotong atau formatnya rusak. Minta Claude mengirim ulang JSON-nya, lalu salin seluruhnya.");
  }
  const parsed = lenient.safeParse(data);
  if (!parsed.success) throw new HandoffError("Isi jawaban tidak sesuai format notulen. Minta Claude mengikuti format JSON yang diminta.");
  const result = parsed.data;
  const empty = !result.topic && !result.opening && !result.summary && result.discussion.length === 0 && result.decisions.length === 0;
  if (empty) throw new HandoffError("Jawaban Claude tidak berisi notulen. Periksa bahwa yang disalin adalah jawaban terakhir.");
  return { ...result, imageCaptions: [] };
}
