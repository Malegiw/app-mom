import { z } from "zod";
import { formatDate, formatTimeRange } from "./format";
import { segmentsToText } from "./transcript";
import { PLATFORM_LABEL, type Lang, type Meeting, type Minutes } from "./types";

/**
 * The parts of minute-writing that do not need the Anthropic SDK: the instructions, the meeting brief,
 * and the shape of the answer. Both the API path (summarize.ts) and the subscription path
 * (handoff.ts, where the person pastes the prompt into claude.ai) build on this file.
 */

export const MinutesSchema = z.object({
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

export const LANGUAGE_NAME: Record<Lang, string> = { id: "Bahasa Indonesia", en: "English" };

export function systemPrompt(language: Lang): string {
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

export function meetingBrief(meeting: Meeting, imageCount: number): string {
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
