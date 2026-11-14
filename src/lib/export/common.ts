import { formatDate, formatDuration, formatTimeRange } from "../format";
import { PLATFORM_LABEL, type Meeting } from "../types";

export interface ExportImage {
  name: string;
  caption: string;
  /** Full data URL, "data:image/jpeg;base64,...". */
  dataUrl: string;
  width: number;
  height: number;
  type: "jpg" | "png";
}

/** Everything an exporter needs, gathered up front so the builders stay free of browser APIs. */
export interface ExportBundle {
  meeting: Meeting;
  images: ExportImage[];
  /** The one-page visual summary drawn by the app, when minutes exist. */
  visual: ExportImage | null;
  /** Pictures Claude drew for the minutes. Their captions read "Title. What it shows." */
  drawings: ExportImage[];
  organization: string;
}

export type ExportKind = "docx" | "xlsx" | "pptx";

export const EXPORT_INFO: Record<ExportKind, { label: string; extension: string; mime: string; description: string }> = {
  docx: {
    label: "Word",
    extension: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    description: "Notulen lengkap dengan gambar, daftar hadir, dan transkrip",
  },
  xlsx: {
    label: "Excel",
    extension: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    description: "Tabel tindak lanjut, keputusan, daftar hadir, dan transkrip",
  },
  pptx: {
    label: "PowerPoint",
    extension: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    description: "Slide ringkasan siap presentasi",
  },
};

export function presentCount(meeting: Meeting): number {
  return meeting.attendees.filter((attendee) => attendee.name.trim() && attendee.present).length;
}

export function namedAttendees(meeting: Meeting) {
  return meeting.attendees.filter((attendee) => attendee.name.trim());
}

/** Label and value pairs for the details block at the top of every export. */
export function metaRows(meeting: Meeting): [string, string][] {
  const rows: [string, string][] = [
    ["Tanggal", formatDate(meeting.date)],
    ["Waktu", formatTimeRange(meeting) || "-"],
    ["Pelaksanaan", PLATFORM_LABEL[meeting.platform]],
    ["Lokasi atau tautan", meeting.location || "-"],
    ["Pemimpin rapat", meeting.organizer || "-"],
    ["Notulis", meeting.notetaker || "-"],
  ];
  if (meeting.durationSec > 0) rows.push(["Durasi", formatDuration(meeting.durationSec)]);
  const named = namedAttendees(meeting).length;
  if (named > 0) rows.push(["Kehadiran", `${presentCount(meeting)} dari ${named} orang hadir`]);
  return rows;
}

export function subtitleLine(meeting: Meeting): string {
  return [formatDate(meeting.date), formatTimeRange(meeting), PLATFORM_LABEL[meeting.platform]].filter(Boolean).join("  |  ");
}
