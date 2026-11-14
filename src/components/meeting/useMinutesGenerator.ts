import { useCallback, useEffect, useRef, useState } from "react";
import { addAsset, db, deleteGeneratedImages, listAssets, updateAsset, updateMeeting } from "@/lib/db";
import { engineClaude, EngineError, getEngine, refreshEngine, type EngineInfo } from "@/lib/engine";
import { safeFileName } from "@/lib/format";
import { blobToDataUrl, dataUrlToBase64, normalizeImage } from "@/lib/images";
import { meetingBrief, MinutesWithVisualsSchema, outputJsonSchema, systemPrompt, toMinutes, type GeneratedVisual } from "@/lib/minutesPrompt";
import { getSettings, type Settings } from "@/lib/settings";
import type { ModelImage } from "@/lib/summarize";
import { uid, type Asset, type Attendee, type Meeting } from "@/lib/types";
import { rasterizeSvg, sanitizeSvg } from "@/lib/visuals";

/** The most pictures sent along with one transcript. More than this adds cost without adding much. */
const MAX_IMAGES = 10;
const PLACEHOLDER_TITLE = "Rapat tanpa judul";

/**
 * Who writes the minutes.
 * "engine": Claude Code on the engine's computer, paid for by the owner's Claude subscription.
 * "api": the Anthropic API with the key from Settings.
 * null: neither is set up, so the person copies a prompt to claude.ai or writes by hand.
 */
export type MinutesProvider = "engine" | "api" | null;

export function pickProvider(engine: EngineInfo, settings: Pick<Settings, "anthropicKey">): MinutesProvider {
  if (engine.state === "ready" && engine.claude.installed && engine.claude.loggedIn) return "engine";
  if (settings.anthropicKey.trim()) return "api";
  return null;
}

export interface MinutesGenerator {
  working: boolean;
  /** What is happening right now, for the status line. */
  stage: "writing" | "drawing";
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

/** Turns the pictures Claude drew into stored images, replacing any earlier set. Returns how many were kept. */
export async function saveVisuals(meetingId: string, visuals: GeneratedVisual[]): Promise<number> {
  await deleteGeneratedImages(meetingId);
  let kept = 0;
  for (const visual of visuals.slice(0, 4)) {
    const svg = sanitizeSvg(visual.svg);
    if (!svg) continue;
    try {
      const picture = await rasterizeSvg(svg);
      const title = visual.title.trim() || `Ilustrasi ${kept + 1}`;
      const caption = visual.caption.trim();
      await addAsset({
        meetingId,
        kind: "image",
        name: `${safeFileName(title)}.png`,
        mime: "image/png",
        blob: picture.blob,
        caption: caption ? `${title}. ${caption}` : title,
        width: picture.width,
        height: picture.height,
        generated: true,
      });
      kept += 1;
    } catch {
      // A drawing the browser cannot render is skipped. The minutes are still complete without it.
    }
  }
  return kept;
}

async function picturesForModel(assets: Asset[]): Promise<ModelImage[]> {
  const images: ModelImage[] = [];
  for (const asset of assets) {
    const scaled = await normalizeImage(asset.blob, 1568, 0.82);
    images.push({ base64: dataUrlToBase64(await blobToDataUrl(scaled.blob)) });
  }
  return images;
}

export function useMinutesGenerator(meeting: Meeting | undefined): MinutesGenerator {
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<MinutesGenerator["stage"]>("writing");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // The freshest copy of the meeting: a recording that just ended may trigger this before React re-renders.
  const latest = useRef(meeting);
  latest.current = meeting;

  useEffect(() => () => controller.current?.abort(), []);

  const generate = useCallback(async () => {
    const current = latest.current;
    if (!current || controller.current) return;
    const settings = getSettings();
    const abort = new AbortController();
    controller.current = abort;
    setWorking(true);
    setStage("writing");
    setProgress(0);
    setError(null);
    try {
      const fresh = (await db.meetings.get(current.id)) ?? current;
      if (fresh.segments.length === 0) throw new EngineError("Transkrip masih kosong. Rekam, impor, atau tempel transkrip lebih dulu.", "empty");

      const engine = getEngine().state === "checking" ? await refreshEngine() : getEngine();
      const provider = pickProvider(engine, settings);
      if (!provider) throw new EngineError("Notulen otomatis belum tersedia di perangkat ini. Nyalakan mesin Notula di komputer, atau pakai cara salin-tempel ke claude.ai.", "no_provider");

      // Only pictures the person added are shown to Claude. Its own earlier drawings are not.
      const assets = (await listAssets(fresh.id, "image")).filter((asset) => !asset.generated).slice(0, MAX_IMAGES);
      const images = await picturesForModel(assets);

      let title = "";
      let captions: { index: number; caption: string }[] = [];

      if (provider === "engine") {
        const withVisuals = settings.makeVisuals;
        const answer = await engineClaude({
          system: systemPrompt(settings.language, withVisuals),
          prompt: meetingBrief(fresh, images.length),
          schema: outputJsonSchema(withVisuals),
          images: images.map((image) => ({ base64: image.base64, mediaType: "image/jpeg" })),
          model: settings.engineModel === "default" ? "" : settings.engineModel,
          signal: abort.signal,
          onProgress: setProgress,
        });
        const parsed = MinutesWithVisualsSchema.safeParse(answer.output);
        if (!parsed.success) throw new EngineError("Jawaban Claude tidak sesuai format notulen. Coba buat ulang.", "bad_output");
        title = parsed.data.title.trim();
        captions = parsed.data.imageCaptions;
        await updateMeeting(fresh.id, {
          minutes: toMinutes(parsed.data, answer.model || "claude"),
          attendees: mergeAttendees(fresh.attendees, parsed.data.attendees),
          ...(fresh.title === PLACEHOLDER_TITLE && title ? { title } : {}),
        });
        if (withVisuals) {
          setStage("drawing");
          await saveVisuals(fresh.id, parsed.data.visuals);
        }
      } else {
        // The Anthropic client is only needed on this path, so it stays out of the first download.
        const { generateMinutes, SummaryError } = await import("@/lib/summarize");
        const result = await generateMinutes({
          apiKey: settings.anthropicKey,
          model: settings.model,
          language: settings.language,
          meeting: fresh,
          images,
          signal: abort.signal,
          onProgress: setProgress,
        }).catch((cause: unknown) => {
          // Its messages are already written for the person reading them: pass them through as they are.
          throw cause instanceof SummaryError ? new EngineError(cause.message, "api") : cause;
        });
        title = result.title.trim();
        captions = result.imageCaptions;
        await updateMeeting(fresh.id, {
          minutes: toMinutes(result, settings.model),
          attendees: mergeAttendees(fresh.attendees, result.attendees),
          ...(fresh.title === PLACEHOLDER_TITLE && title ? { title } : {}),
        });
      }

      // Captions the person already wrote stay as they are.
      for (const { index, caption } of captions) {
        const asset = assets[index - 1];
        if (asset && !asset.caption.trim() && caption.trim()) await updateAsset(asset.id, { caption: caption.trim() });
      }
    } catch (cause) {
      if (abort.signal.aborted) return;
      setError(cause instanceof EngineError ? cause.message : "Notulen gagal dibuat. Coba lagi beberapa saat lagi.");
    } finally {
      controller.current = null;
      setWorking(false);
    }
  }, []);

  const cancel = useCallback(() => controller.current?.abort(), []);
  const clearError = useCallback(() => setError(null), []);

  return { working, stage, progress, error, generate, cancel, clearError };
}
