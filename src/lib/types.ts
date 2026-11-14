export type Platform = "offline" | "teams" | "zoom" | "meet" | "other";
export type Lang = "id" | "en";

export interface Attendee {
  id: string;
  name: string;
  role: string;
  org: string;
  present: boolean;
}

/** One stretch of speech. `start` is seconds from the beginning of the meeting, or null when unknown. */
export interface Segment {
  id: string;
  start: number | null;
  speaker: string;
  text: string;
  /** Which recording or import produced this segment, so a later transcription of the same audio can replace it. */
  source?: string;
}

export interface DiscussionItem {
  heading: string;
  summary: string;
  points: string[];
}

export interface ActionItem {
  task: string;
  owner: string;
  due: string;
}

/** The minutes themselves: opening topic, objectives, discussion, decisions, follow-ups, and closing summary. */
export interface Minutes {
  topic: string;
  opening: string;
  objectives: string[];
  discussion: DiscussionItem[];
  decisions: string[];
  actionItems: ActionItem[];
  summary: string;
  generatedAt: number;
  source: "ai" | "manual";
  model?: string;
}

export interface Meeting {
  id: string;
  title: string;
  /** ISO date, yyyy-mm-dd. */
  date: string;
  /** hh:mm, 24 hour. */
  startTime: string;
  endTime: string;
  platform: Platform;
  location: string;
  organizer: string;
  notetaker: string;
  attendees: Attendee[];
  segments: Segment[];
  minutes: Minutes | null;
  durationSec: number;
  language: Lang;
  createdAt: number;
  updatedAt: number;
  isSample?: boolean;
}

export interface Asset {
  id: string;
  meetingId: string;
  kind: "image" | "audio";
  name: string;
  mime: string;
  blob: Blob;
  caption: string;
  width: number;
  height: number;
  createdAt: number;
  /** Audio only: links the recording to the transcript segments captured while it was made. */
  sessionId?: string;
  /** Audio only: where this recording starts on the meeting's clock, in seconds. */
  offsetSec?: number;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  offline: "Tatap muka",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  meet: "Google Meet",
  other: "Lainnya",
};

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function emptyMinutes(): Minutes {
  return {
    topic: "",
    opening: "",
    objectives: [],
    discussion: [],
    decisions: [],
    actionItems: [],
    summary: "",
    generatedAt: Date.now(),
    source: "manual",
  };
}
