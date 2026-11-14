import { useCallback, useEffect, useRef, useState } from "react";
import { addAsset, appendLiveText, db } from "@/lib/db";
import { nowHHMM, todayISO } from "@/lib/format";
import { describeCaptureError, extensionForMime, startRecording, type AudioSource, type RecordingSession } from "@/lib/recorder";
import { LiveTranscriber, speechSupported } from "@/lib/speech";
import { uid, type Meeting } from "@/lib/types";

export type RecorderStatus = "idle" | "starting" | "recording" | "paused" | "saving";

interface ActiveRecording {
  session: RecordingSession;
  transcriber: LiveTranscriber | null;
  sessionId: string;
  meetingId: string;
  /** Meeting length before this recording began, so timestamps continue across several recordings. */
  base: number;
  accumulated: number;
  resumedAt: number;
  running: boolean;
  wakeLock: { release: () => Promise<void> } | null;
  timer: number;
}

export interface Recorder {
  status: RecorderStatus;
  /** Seconds recorded in the current session. */
  elapsed: number;
  /** Words heard but not yet final. */
  interim: string;
  error: string | null;
  /** A problem with live captions that does not stop the audio recording. */
  notice: string | null;
  liveCaptions: boolean;
  start: (options: { source: AudioSource; live: boolean }) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  level: () => number;
}

/**
 * Owns one recording at a time for a meeting. It lives above the tabs so a recording keeps running
 * while the person looks at minutes, attendees, or pictures.
 */
export function useRecorder(meeting: Meeting | undefined): Recorder {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveCaptions, setLiveCaptions] = useState(false);
  const active = useRef<ActiveRecording | null>(null);

  const seconds = () => {
    const rec = active.current;
    if (!rec) return 0;
    return rec.accumulated + (rec.running ? (performance.now() - rec.resumedAt) / 1000 : 0);
  };

  const finish = useCallback(async () => {
    const rec = active.current;
    if (!rec) return;
    active.current = null;
    window.clearInterval(rec.timer);
    rec.transcriber?.stop();
    const total = rec.accumulated + (rec.running ? (performance.now() - rec.resumedAt) / 1000 : 0);
    void rec.wakeLock?.release().catch(() => undefined);
    const blob = await rec.session.stop();
    if (blob.size > 0) {
      await addAsset({
        meetingId: rec.meetingId,
        kind: "audio",
        name: `Rekaman ${todayISO()} ${nowHHMM().replace(":", ".")}.${extensionForMime(rec.session.mime)}`,
        mime: rec.session.mime,
        blob,
        caption: "",
        width: 0,
        height: 0,
        sessionId: rec.sessionId,
        offsetSec: rec.base,
      });
    }
    await db.meetings.update(rec.meetingId, { durationSec: Math.round(rec.base + total), endTime: nowHHMM(), updatedAt: Date.now() });
  }, []);

  const start = useCallback<Recorder["start"]>(
    async ({ source, live }) => {
      if (!meeting || active.current || status !== "idle") return;
      setError(null);
      setNotice(null);
      setInterim("");
      setElapsed(0);
      setStatus("starting");

      const sessionId = uid();
      const meetingId = meeting.id;
      const base = meeting.durationSec;

      // Speech recognition must start inside the tap that asked for it, so it begins before the
      // microphone prompt resolves. Captions that arrive early are stamped from zero.
      let transcriber: LiveTranscriber | null = null;
      if (live && speechSupported()) {
        transcriber = new LiveTranscriber(meeting.language, {
          onFinal: (text) => void appendLiveText(meetingId, sessionId, text, base + seconds()),
          onInterim: setInterim,
          onError: setNotice,
        });
        transcriber.start();
      }
      setLiveCaptions(transcriber !== null);

      try {
        const session = await startRecording(source);
        let wakeLock: ActiveRecording["wakeLock"] = null;
        try {
          // Keeps a phone or tablet from sleeping mid-meeting. Not every browser has it.
          const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
          wakeLock = (await nav.wakeLock?.request("screen")) ?? null;
        } catch {
          wakeLock = null;
        }
        active.current = {
          session,
          transcriber,
          sessionId,
          meetingId,
          base,
          accumulated: 0,
          resumedAt: performance.now(),
          running: true,
          wakeLock,
          timer: window.setInterval(() => setElapsed(seconds()), 250),
        };
        setStatus("recording");
      } catch (cause) {
        transcriber?.stop();
        setLiveCaptions(false);
        setError(describeCaptureError(cause));
        setStatus("idle");
      }
    },
    [meeting, status],
  );

  const pause = useCallback(() => {
    const rec = active.current;
    if (!rec || !rec.running) return;
    rec.accumulated += (performance.now() - rec.resumedAt) / 1000;
    rec.running = false;
    rec.session.pause();
    rec.transcriber?.stop();
    setInterim("");
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const rec = active.current;
    if (!rec || rec.running) return;
    rec.resumedAt = performance.now();
    rec.running = true;
    rec.session.resume();
    rec.transcriber?.start();
    setStatus("recording");
  }, []);

  const stop = useCallback(async () => {
    if (!active.current) return;
    setStatus("saving");
    setInterim("");
    try {
      await finish();
    } catch {
      setError("Rekaman gagal disimpan. Transkrip yang sudah tercatat tetap aman.");
    } finally {
      setElapsed(0);
      setLiveCaptions(false);
      setStatus("idle");
    }
  }, [finish]);

  // Leaving the meeting page ends the recording and keeps what was captured.
  useEffect(
    () => () => {
      void finish();
    },
    [finish],
  );

  // Closing the tab mid-recording would lose the audio, so ask first.
  useEffect(() => {
    if (status === "idle") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  const level = useCallback(() => (active.current?.running ? active.current.session.level() : 0), []);

  return { status, elapsed, interim, error, notice, liveCaptions, start, pause, resume, stop, level };
}
