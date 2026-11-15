import { useCallback, useEffect, useRef, useState } from "react";
import { addAsset, appendLiveSegments, appendLiveText, db } from "@/lib/db";
import { engineTranscribe } from "@/lib/engine";
import { nowHHMM, todayISO } from "@/lib/format";
import { LiveChunker, type AudioChunk } from "@/lib/liveAudio";
import { describeCaptureError, extensionForMime, startRecording, type AudioSource, type RecordingSession } from "@/lib/recorder";
import { LiveTranscriber, speechSupported } from "@/lib/speech";
import { uid, type Lang, type Meeting } from "@/lib/types";

type WakeLockSentinel = { release: () => Promise<void> };

/** Asks the browser to keep the screen on. Not every browser has it, and it can refuse, so failure is quiet. */
async function keepScreenOn(): Promise<WakeLockSentinel | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> } };
    return (await nav.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

export type RecorderStatus = "idle" | "starting" | "recording" | "paused" | "saving";

/**
 * How words reach the transcript while recording.
 * "engine": the Notula engine transcribes short pieces with Whisper. Hears everything that is recorded.
 * "browser": the browser's own speech recognition. Hears the microphone only.
 * "off": audio is recorded and transcribed later.
 */
export type LiveMode = "engine" | "browser" | "off";

export interface FinishedRecording {
  meetingId: string;
  sessionId: string;
  /** Whether a live transcript was being written during this recording. */
  transcribed: boolean;
}

interface ActiveRecording {
  session: RecordingSession;
  transcriber: LiveTranscriber | null;
  chunker: LiveChunker | null;
  /** Live pieces still being transcribed by the engine, in order. */
  pending: Promise<void>;
  lastText: string;
  language: Lang;
  mode: LiveMode;
  sessionId: string;
  meetingId: string;
  /** Meeting length before this recording began, so timestamps continue across several recordings. */
  base: number;
  accumulated: number;
  resumedAt: number;
  running: boolean;
  wakeLock: WakeLockSentinel | null;
  /** When the page was last hidden, or 0. Hidden pages may lose the microphone. */
  hiddenAt: number;
  timer: number;
}

export interface Recorder {
  status: RecorderStatus;
  /** Seconds recorded in the current session. */
  elapsed: number;
  /** Words heard but not yet final (browser captions only). */
  interim: string;
  error: string | null;
  /** A problem with the live transcript that does not stop the audio recording. */
  notice: string | null;
  liveMode: LiveMode;
  /** Pieces of audio waiting for the engine to transcribe. */
  backlog: number;
  start: (options: { source: AudioSource; live: LiveMode }) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  level: () => number;
}

/**
 * Owns one recording at a time for a meeting. It lives above the tabs so a recording keeps running
 * while the person looks at minutes, attendees, or pictures.
 */
export function useRecorder(meeting: Meeting | undefined, onFinished?: (recording: FinishedRecording) => void): Recorder {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState<LiveMode>("off");
  const [backlog, setBacklog] = useState(0);
  const active = useRef<ActiveRecording | null>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const mounted = useRef(true);
  const stopRef = useRef<() => Promise<void>>(async () => undefined);

  const seconds = () => {
    const rec = active.current;
    if (!rec) return 0;
    return rec.accumulated + (rec.running ? (performance.now() - rec.resumedAt) / 1000 : 0);
  };

  /** Sends one piece to the engine. Pieces are handled one after another so the text stays in order. */
  const transcribeChunk = (rec: ActiveRecording, chunk: AudioChunk) => {
    setBacklog((count) => count + 1);
    rec.pending = rec.pending.then(async () => {
      try {
        const result = await engineTranscribe(chunk.wav, { language: rec.language, prompt: rec.lastText, wav16k: true });
        const items = result.segments.map((segment) => ({ start: rec.base + chunk.startSec + segment.start, text: segment.text }));
        if (items.length > 0) {
          rec.lastText = `${rec.lastText} ${items.map((item) => item.text).join(" ")}`.slice(-300);
          await appendLiveSegments(rec.meetingId, rec.sessionId, items);
        }
      } catch (cause) {
        if (mounted.current) setNotice(cause instanceof Error ? cause.message : "Transkrip langsung terputus. Rekaman audio tetap berjalan.");
      } finally {
        if (mounted.current) setBacklog((count) => Math.max(0, count - 1));
      }
    });
  };

  const finish = useCallback(async (announce: boolean) => {
    const rec = active.current;
    if (!rec) return;
    active.current = null;
    window.clearInterval(rec.timer);
    rec.transcriber?.stop();
    const total = rec.accumulated + (rec.running ? (performance.now() - rec.resumedAt) / 1000 : 0);
    void rec.wakeLock?.release().catch(() => undefined);
    const blob = await rec.session.stop();
    // The tail of the recording is still in the chunker: send it, then wait for every piece to come back.
    rec.chunker?.flush();
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
    await rec.pending;
    if (announce) finished.current?.({ meetingId: rec.meetingId, sessionId: rec.sessionId, transcribed: rec.mode !== "off" });
  }, []);

  const start = useCallback<Recorder["start"]>(
    async ({ source, live }) => {
      if (!meeting || active.current || status !== "idle") return;
      setError(null);
      setNotice(null);
      setInterim("");
      setElapsed(0);
      setBacklog(0);
      setStatus("starting");

      const sessionId = uid();
      const meetingId = meeting.id;
      const base = meeting.durationSec;
      // The browser's captions only hear the microphone, so they make no sense for shared sound alone.
      const mode: LiveMode = live === "browser" && (source === "system" || !speechSupported()) ? "off" : live;

      // Speech recognition must start inside the tap that asked for it, so it begins before the
      // microphone prompt resolves. Captions that arrive early are stamped from zero.
      let transcriber: LiveTranscriber | null = null;
      if (mode === "browser") {
        transcriber = new LiveTranscriber(meeting.language, {
          onFinal: (text) => void appendLiveText(meetingId, sessionId, text, base + seconds()),
          onInterim: setInterim,
          onError: setNotice,
        });
        transcriber.start();
      }
      setLiveMode(mode);

      // The record is created before the audio starts so the chunker has somewhere to send its pieces.
      const rec: ActiveRecording = {
        session: undefined as unknown as RecordingSession,
        transcriber,
        chunker: null,
        pending: Promise.resolve(),
        lastText: "",
        language: meeting.language,
        mode,
        sessionId,
        meetingId,
        base,
        accumulated: 0,
        resumedAt: 0,
        running: false,
        wakeLock: null,
        hiddenAt: 0,
        timer: 0,
      };

      try {
        let chunker: LiveChunker | null = null;
        const session = await startRecording(source, {
          onPcm: mode === "engine" ? (frame) => chunker?.push(frame) : undefined,
          onEnded: () => void stopRef.current(),
        });
        if (mode === "engine") chunker = new LiveChunker(session.sampleRate, (chunk) => transcribeChunk(rec, chunk));
        // Keeps a phone or tablet from sleeping mid-meeting.
        rec.wakeLock = await keepScreenOn();
        rec.session = session;
        rec.chunker = chunker;
        rec.resumedAt = performance.now();
        rec.running = true;
        rec.timer = window.setInterval(() => setElapsed(seconds()), 250);
        active.current = rec;
        setStatus("recording");
      } catch (cause) {
        transcriber?.stop();
        setLiveMode("off");
        setError(describeCaptureError(cause));
        setStatus("idle");
      }
    },
    // transcribeChunk only touches refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await finish(true);
    } catch {
      setError("Rekaman gagal disimpan. Transkrip yang sudah tercatat tetap aman.");
    } finally {
      setElapsed(0);
      setLiveMode("off");
      setStatus("idle");
    }
  }, [finish]);
  stopRef.current = stop;

  // Leaving the meeting page ends the recording and keeps what was captured.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void finish(false);
    };
  }, [finish]);

  // The browser lets go of the screen lock whenever the page is hidden. Take it again on return, and
  // say so if the page was away long enough that the microphone may have been cut.
  useEffect(() => {
    if (status !== "recording" && status !== "paused") return;
    const onVisibility = () => {
      const rec = active.current;
      if (!rec) return;
      if (document.visibilityState === "hidden") {
        rec.hiddenAt = performance.now();
        return;
      }
      void keepScreenOn().then((lock) => {
        void rec.wakeLock?.release().catch(() => undefined);
        rec.wakeLock = lock;
      });
      const awayMs = rec.hiddenAt ? performance.now() - rec.hiddenAt : 0;
      rec.hiddenAt = 0;
      if (rec.running && awayMs > 3000) {
        setNotice("Notula sempat berada di latar belakang, jadi rekaman mungkin terpotong selama itu. Biarkan Notula tetap di layar saat merekam.");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [status]);

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

  return { status, elapsed, interim, error, notice, liveMode, backlog, start, pause, resume, stop, level };
}
