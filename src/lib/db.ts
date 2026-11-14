import Dexie, { type EntityTable } from "dexie";
import { nowHHMM, todayISO } from "./format";
import { uid, type Asset, type Lang, type Meeting, type Platform, type Segment } from "./types";

/** Everything stays on the device: meetings, audio, and pictures live in the browser's IndexedDB. */
class NotulaDB extends Dexie {
  meetings!: EntityTable<Meeting, "id">;
  assets!: EntityTable<Asset, "id">;

  constructor() {
    super("notula");
    this.version(1).stores({
      meetings: "id, updatedAt, date",
      assets: "id, meetingId, kind, createdAt",
    });
  }
}

export const db = new NotulaDB();

export interface NewMeetingInput {
  title: string;
  platform: Platform;
  date?: string;
  startTime?: string;
  location?: string;
  language: Lang;
  organizer?: string;
  notetaker?: string;
}

export async function createMeeting(input: NewMeetingInput): Promise<Meeting> {
  const now = Date.now();
  const meeting: Meeting = {
    id: uid(),
    title: input.title.trim() || "Rapat tanpa judul",
    date: input.date || todayISO(),
    startTime: input.startTime ?? nowHHMM(),
    endTime: "",
    platform: input.platform,
    location: input.location ?? "",
    organizer: input.organizer ?? "",
    notetaker: input.notetaker ?? "",
    attendees: [],
    segments: [],
    minutes: null,
    durationSec: 0,
    language: input.language,
    createdAt: now,
    updatedAt: now,
  };
  await db.meetings.add(meeting);
  return meeting;
}

export async function updateMeeting(id: string, patch: Partial<Omit<Meeting, "id">>): Promise<void> {
  await db.meetings.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteMeeting(id: string): Promise<void> {
  await db.transaction("rw", db.meetings, db.assets, async () => {
    await db.assets.where("meetingId").equals(id).delete();
    await db.meetings.delete(id);
  });
}

export async function deleteEverything(): Promise<void> {
  await db.transaction("rw", db.meetings, db.assets, async () => {
    await db.assets.clear();
    await db.meetings.clear();
  });
}

export async function addAsset(asset: Omit<Asset, "id" | "createdAt">): Promise<Asset> {
  const full: Asset = { ...asset, id: uid(), createdAt: Date.now() };
  await db.assets.add(full);
  await db.meetings.update(asset.meetingId, { updatedAt: Date.now() });
  return full;
}

export async function updateAsset(id: string, patch: Partial<Pick<Asset, "caption" | "name">>): Promise<void> {
  await db.assets.update(id, patch);
}

export async function deleteAsset(id: string): Promise<void> {
  await db.assets.delete(id);
}

export function listAssets(meetingId: string, kind: Asset["kind"]): Promise<Asset[]> {
  return db.assets
    .where("meetingId")
    .equals(meetingId)
    .filter((asset) => asset.kind === kind)
    .sortBy("createdAt");
}

/** Adds segments to the end of the transcript and stretches the meeting length if the import runs longer. */
export async function appendSegments(meetingId: string, segments: Segment[], durationHint = 0): Promise<void> {
  await db.meetings
    .where("id")
    .equals(meetingId)
    .modify((meeting) => {
      meeting.segments.push(...segments);
      if (durationHint > meeting.durationSec) meeting.durationSec = durationHint;
      meeting.updatedAt = Date.now();
    });
}

/**
 * Swaps in a fresh transcription of one recording. Segments captured live from the same recording
 * are removed first, and the new ones take their place in the transcript.
 */
export async function replaceSourceSegments(meetingId: string, source: string, segments: Segment[], durationHint = 0): Promise<void> {
  await db.meetings
    .where("id")
    .equals(meetingId)
    .modify((meeting) => {
      const firstIndex = meeting.segments.findIndex((segment) => segment.source === source);
      const kept = meeting.segments.filter((segment) => segment.source !== source);
      const at = firstIndex === -1 ? kept.length : Math.min(firstIndex, kept.length);
      kept.splice(at, 0, ...segments.map((segment) => ({ ...segment, source })));
      meeting.segments = kept;
      if (durationHint > meeting.durationSec) meeting.durationSec = durationHint;
      meeting.updatedAt = Date.now();
    });
}

/**
 * Adds one live caption. Captions arrive a phrase at a time, so phrases close together are joined
 * into a paragraph instead of piling up as one-line segments.
 */
export async function appendLiveText(meetingId: string, sessionId: string, phrase: string, atSeconds: number): Promise<void> {
  const trimmed = phrase.trim();
  if (!trimmed) return;
  const sentence = `${trimmed[0].toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
  await db.meetings
    .where("id")
    .equals(meetingId)
    .modify((meeting) => {
      const last = meeting.segments[meeting.segments.length - 1];
      const sameRun = last && last.source === sessionId && last.text.length + sentence.length < 480 && atSeconds - (last.start ?? atSeconds) < 60;
      if (sameRun) last.text = `${last.text} ${sentence}`;
      else meeting.segments.push({ id: uid(), start: Math.round(atSeconds), speaker: "", text: sentence, source: sessionId });
      meeting.updatedAt = Date.now();
    });
}

/**
 * Adds text that the engine transcribed from one live chunk. Like captions, chunks close together
 * are joined into paragraphs so the transcript reads as speech, not as a list of fragments.
 */
export async function appendLiveSegments(meetingId: string, sessionId: string, items: { start: number; text: string }[]): Promise<void> {
  const fresh = items.map((item) => ({ start: item.start, text: item.text.trim() })).filter((item) => item.text);
  if (fresh.length === 0) return;
  await db.meetings
    .where("id")
    .equals(meetingId)
    .modify((meeting) => {
      for (const item of fresh) {
        const last = meeting.segments[meeting.segments.length - 1];
        const sameRun =
          last !== undefined &&
          last.source === sessionId &&
          !last.speaker &&
          last.text.length + item.text.length < 520 &&
          item.start - (last.start ?? item.start) < 75;
        if (sameRun) last.text = `${last.text} ${item.text}`;
        else meeting.segments.push({ id: uid(), start: Math.round(item.start), speaker: "", text: item.text, source: sessionId });
      }
      meeting.updatedAt = Date.now();
    });
}

/** Removes the pictures Claude drew for a meeting, before a fresh set replaces them. */
export async function deleteGeneratedImages(meetingId: string): Promise<void> {
  await db.assets
    .where("meetingId")
    .equals(meetingId)
    .filter((asset) => asset.kind === "image" && asset.generated === true)
    .delete();
}
