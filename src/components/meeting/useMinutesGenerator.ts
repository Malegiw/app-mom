import { useCallback, useEffect, useRef, useState } from "react";
import { listAssets, updateAsset, updateMeeting } from "@/lib/db";
import { blobToDataUrl, dataUrlToBase64, normalizeImage } from "@/lib/images";
import { getSettings } from "@/lib/settings";
import type { ModelImage } from "@/lib/summarize";
import { uid, type Attendee, type Meeting } from "@/lib/types";

/** The most pictures sent along with one transcript. More than this adds cost without adding much. */
const MAX_IMAGES = 10;
const PLACEHOLDER_TITLE = "Rapat tanpa judul";

export interface MinutesGenerator {
  working: boolean;
  /** Characters written so far, as a sign of progress. */
  progress: number;
  error: string | null;
  generate: () => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

/** Adds people the model found in the transcript, and fills in roles that were left empty. */
export function mergeAttendees(current: Attendee[], found: { name: string; role: string }[]): Attendee[] {
  const merged = current.map((attendee) => ({ ...attendee }));
  const byName = new Map(merged.map((attendee) => [attendee.name.trim().toLowerCase(), attendee]));
  for (const person of found) {
    const name = person.name.trim();
    if (!name) continue;
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      if (!existing.role.trim() && person.role.trim()) existing.role = person.role.trim();
      continue;
    }
    const added: Attendee = { id: uid(), name, role: person.role.trim(), org: "", present: true };
    merged.push(added);
    byName.set(name.toLowerCase(), added);
  }
  return merged;
}

export function useMinutesGenerator(meeting: Meeting | undefined): MinutesGenerator {
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const generate = useCallback(async () => {
    if (!meeting || controller.current) return;
    const settings = getSettings();
    const abort = new AbortController();
    controller.current = abort;
    setWorking(true);
    setProgress(0);
    setError(null);
    // The Claude client is only needed here, so it is fetched on first use and stays out of the first download.
    const summarize = await import("@/lib/summarize").catch(() => null);
    if (!summarize) {
      controller.current = null;
      setWorking(false);
      setError("Bagian notulen otomatis belum terunduh. Sambungkan internet, lalu coba lagi.");
      return;
    }
    const { generateMinutes, SummaryError, toMinutes } = summarize;
    try {
      const assets = (await listAssets(meeting.id, "image")).slice(0, MAX_IMAGES);
      const images: ModelImage[] = [];
      for (const asset of assets) {
        const scaled = await normalizeImage(asset.blob, 1568, 0.82);
        images.push({ base64: dataUrlToBase64(await blobToDataUrl(scaled.blob)) });
      }

      const result = await generateMinutes({
        apiKey: settings.anthropicKey,
        model: settings.model,
        language: settings.language,
        meeting,
        images,
        signal: abort.signal,
        onProgress: setProgress,
      });

      const title = result.title.trim();
      await updateMeeting(meeting.id, {
        minutes: toMinutes(result, settings.model),
        attendees: mergeAttendees(meeting.attendees, result.attendees),
        ...(meeting.title === PLACEHOLDER_TITLE && title ? { title } : {}),
      });

      // Captions the person already wrote stay as they are.
      for (const { index, caption } of result.imageCaptions) {
        const asset = assets[index - 1];
        if (asset && !asset.caption.trim() && caption.trim()) await updateAsset(asset.id, { caption: caption.trim() });
      }
    } catch (cause) {
      if (abort.signal.aborted) return;
      setError(cause instanceof SummaryError ? cause.message : "Notulen gagal dibuat. Coba lagi beberapa saat lagi.");
    } finally {
      controller.current = null;
      setWorking(false);
    }
  }, [meeting]);

  const cancel = useCallback(() => controller.current?.abort(), []);
  const clearError = useCallback(() => setError(null), []);

  return { working, progress, error, generate, cancel, clearError };
}
