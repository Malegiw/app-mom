import { formatClock } from "./format";
import { uid, type Segment } from "./types";

const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?`;
const CUE_LINE = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`);
const VOICE_TAG = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/i;
/** "Budi Santoso: mari kita mulai". The name part stays short and free of sentence punctuation. */
const NAME_PREFIX = /^([^\s:][^:.!?\n]{0,48}?)\s*:\s+(\S.*)$/s;
/** "[00:12] Budi: ..." or "00:12:03 Budi: ..." at the start of a plain-text line. */
const LEADING_TIME = new RegExp(String.raw`^\s*[\[(]?${TIME}[\])]?\s*[-–]?\s*`);

function toSeconds(h: string | undefined, m: string, s: string, ms: string | undefined): number {
  const fraction = ms ? Number(`0.${ms}`) : 0;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + fraction;
}

function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Line labels that read like "Name: text" but are not people. */
const NOT_A_SPEAKER = /^(catatan|note|notes|agenda|topik|topic|tujuan|keputusan|kesimpulan|rangkuman|ringkasan|tindak lanjut|action items?|todo|https?)$/i;

function splitSpeaker(text: string): { speaker: string; text: string } {
  const match = NAME_PREFIX.exec(text);
  if (match && !/^\d+$/.test(match[1]) && !NOT_A_SPEAKER.test(match[1].trim())) {
    return { speaker: match[1].trim(), text: match[2].trim() };
  }
  return { speaker: "", text };
}

/**
 * Cue-based transcripts: WebVTT (Teams, Zoom, Meet), SRT, and the Word transcript Teams exports.
 * A cue starts at any line holding "start --> end"; everything until the next such line is its payload.
 * `nameOnOwnLine` covers the Teams Word layout, where the speaker sits alone on the first payload line.
 */
export function parseCues(input: string, nameOnOwnLine = false): Segment[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const segments: Segment[] = [];
  let current: { start: number; payload: string[] } | null = null;

  const flush = (cue: { start: number; payload: string[] } | null) => {
    if (!cue) return;
    const payload = cue.payload.map((line) => line.trim()).filter(Boolean);
    if (payload.length === 0) return;
    let speaker = "";
    let body = payload;
    const voice = VOICE_TAG.exec(payload[0]);
    if (voice) {
      speaker = voice[1].trim();
    } else if (nameOnOwnLine && payload.length >= 2 && payload[0].length <= 60 && !/[.!?]$/.test(payload[0])) {
      speaker = payload[0];
      body = payload.slice(1);
    }
    let text = stripTags(body.join(" "));
    if (!speaker) {
      const split = splitSpeaker(text);
      speaker = split.speaker;
      text = split.text;
    }
    if (text) segments.push({ id: uid(), start: cue.start, speaker, text });
  };

  for (const line of lines) {
    const cue = CUE_LINE.exec(line);
    if (cue) {
      flush(current);
      current = { start: toSeconds(cue[1], cue[2], cue[3], cue[4]), payload: [] };
      continue;
    }
    if (!current) continue;
    // SRT counters and VTT cue identifiers sit on the line before a cue: skip bare numbers and notes.
    if (/^\s*\d+\s*$/.test(line) || /^\s*(NOTE|STYLE|REGION)\b/.test(line)) continue;
    current.payload.push(line);
  }
  flush(current);
  return segments;
}

/** Plain text: one utterance per line or paragraph, with optional "[time] Name: " prefixes. */
export function parsePlain(input: string): Segment[] {
  const blocks = input
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const segments: Segment[] = [];
  for (const block of blocks) {
    let rest = block;
    let start: number | null = null;
    const time = LEADING_TIME.exec(rest);
    if (time && time[0].trim().length > 0) {
      start = toSeconds(time[1], time[2], time[3], time[4]);
      rest = rest.slice(time[0].length);
    }
    const { speaker, text } = splitSpeaker(rest);
    if (!text) continue;
    segments.push({ id: uid(), start, speaker, text });
  }
  return segments;
}

/** Picks the right parser from the content itself, so a renamed or extension-less file still works. */
export function parseTranscript(input: string, options: { nameOnOwnLine?: boolean } = {}): Segment[] {
  const text = input.replace(/^﻿/, "");
  const looksLikeCues = /^\s*WEBVTT/.test(text) || CUE_LINE.test(text) || /\n\s*\d[\d:.,]*\s*-->\s*\d/.test(text);
  // Captions come as short fragments and read better joined; lines someone typed or pasted stay as written.
  return looksLikeCues ? mergeSegments(parseCues(text, options.nameOnOwnLine)) : parsePlain(text);
}

/**
 * Captions arrive as short fragments. Joining consecutive fragments from the same speaker gives
 * paragraphs that read like a transcript, while a cap on length keeps each one easy to scan and edit.
 */
export function mergeSegments(segments: Segment[], maxChars = 700): Segment[] {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker === segment.speaker && previous.text.length + segment.text.length < maxChars) {
      previous.text = `${previous.text} ${segment.text}`.trim();
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/** Turns timed text from a speech engine into transcript paragraphs, shifted by `offset` seconds. */
export function fromTimedText(items: { start: number; text: string }[], offset = 0): Segment[] {
  return mergeSegments(
    items
      .map((item) => ({ id: uid(), start: Math.round((offset + item.start) * 10) / 10, speaker: "", text: item.text.trim() }))
      .filter((segment) => segment.text),
  );
}

/** Pulls paragraph text out of a .docx (a zip of XML) without a full Word parser. */
export async function docxToText(data: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Berkas Word ini tidak berisi dokumen yang bisa dibaca.");
  const xml = await file.async("string");
  const paragraphs = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const withBreaks = paragraph.replace(/<w:(br|cr)\b[^>]*\/>/g, "<w:t>\n</w:t>").replace(/<w:tab\b[^>]*\/>/g, "<w:t> </w:t>");
    const runs = [...withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    const text = runs
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    lines.push(text);
  }
  return lines.join("\n");
}

export function segmentsToText(segments: Segment[], withTime = true): string {
  return segments
    .map((segment) => {
      const time = withTime && segment.start !== null ? `[${formatClock(segment.start)}] ` : "";
      const speaker = segment.speaker ? `${segment.speaker}: ` : "";
      return `${time}${speaker}${segment.text}`;
    })
    .join("\n");
}

export function uniqueSpeakers(segments: Segment[]): string[] {
  const seen = new Set<string>();
  for (const segment of segments) if (segment.speaker.trim()) seen.add(segment.speaker.trim());
  return [...seen];
}

export function wordCount(segments: Segment[]): number {
  return segments.reduce((total, segment) => total + segment.text.split(/\s+/).filter(Boolean).length, 0);
}

/** Last known timestamp, used as a duration estimate for imported transcripts. */
export function lastTimestamp(segments: Segment[]): number {
  let last = 0;
  for (const segment of segments) if (segment.start !== null && segment.start > last) last = segment.start;
  return Math.round(last);
}
