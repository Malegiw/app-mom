import { useEffect, useSyncExternalStore } from "react";
import { getSettings } from "./settings";
import type { Lang } from "./types";

/**
 * The Notula engine is a small server on the computer that owns the Claude subscription.
 * It turns speech into text with Whisper and writes minutes through Claude Code, so the app needs
 * no API key. This file finds the engine and talks to it.
 */

export interface EngineUsage {
  status: string;
  /** Share of the plan's rolling five-hour allowance already used, 0 to 1. */
  fiveHour: number | null;
  sevenDay: number | null;
  resetsAt: number | null;
}

export interface EngineInfo {
  state: "checking" | "offline" | "needs-code" | "ready";
  /** Address to call. An empty string means the engine serves this page itself. */
  base: string;
  version: string;
  whisper: boolean;
  ffmpeg: boolean;
  claude: { installed: boolean; loggedIn: boolean; plan: string };
  usage: EngineUsage | null;
  lan: boolean;
}

const OFFLINE: EngineInfo = {
  state: "offline",
  base: "",
  version: "",
  whisper: false,
  ffmpeg: false,
  claude: { installed: false, loggedIn: false, plan: "" },
  usage: null,
  lan: false,
};

let info: EngineInfo = { ...OFFLINE, state: "checking" };
const listeners = new Set<() => void>();
let checking: Promise<EngineInfo> | null = null;

function set(next: EngineInfo) {
  info = next;
  listeners.forEach((listener) => listener());
}

function candidates(): string[] {
  const custom = getSettings().engineUrl.trim().replace(/\/+$/, "");
  if (custom) return [custom];
  const host = window.location.hostname;
  // The published site never goes looking on its own: only someone who typed an engine address gets one.
  if (host.endsWith("github.io")) return [];
  const list = [""];
  // A development server on this computer: the engine is next door on its usual port.
  if ((host === "localhost" || host === "127.0.0.1") && window.location.port !== "8787") list.push("http://127.0.0.1:8787");
  return list;
}

function authHeaders(): Record<string, string> {
  const code = getSettings().engineCode.trim();
  return code ? { authorization: `Bearer ${code}` } : {};
}

async function probe(base: string): Promise<EngineInfo | null> {
  try {
    const response = await fetch(`${base}/api/health`, { headers: authHeaders(), signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    const body = (await response.json()) as {
      name?: string;
      version?: string;
      needsCode?: boolean;
      whisper?: { ready?: boolean; ffmpeg?: boolean };
      claude?: EngineInfo["claude"];
      usage?: EngineUsage | null;
      lan?: { enabled?: boolean };
    };
    if (body.name !== "notula-engine") return null;
    if (body.needsCode) return { ...OFFLINE, state: "needs-code", base, version: body.version ?? "" };
    return {
      state: "ready",
      base,
      version: body.version ?? "",
      whisper: Boolean(body.whisper?.ready),
      ffmpeg: Boolean(body.whisper?.ffmpeg),
      claude: body.claude ?? OFFLINE.claude,
      usage: body.usage ?? null,
      lan: Boolean(body.lan?.enabled),
    };
  } catch {
    return null;
  }
}

/** Looks for the engine again. Safe to call often: overlapping calls share one check. */
export function refreshEngine(): Promise<EngineInfo> {
  if (checking) return checking;
  checking = (async () => {
    let found: EngineInfo | null = null;
    for (const base of candidates()) {
      found = await probe(base);
      if (found) break;
    }
    set(found ?? OFFLINE);
    checking = null;
    return info;
  })();
  return checking;
}

export const getEngine = () => info;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let watchers = 0;
let interval: number | undefined;
const onFocus = () => void refreshEngine();

/** The engine's current status, kept fresh while any part of the page is using it. */
export function useEngine(): EngineInfo {
  useEffect(() => {
    watchers += 1;
    if (watchers === 1) {
      void refreshEngine();
      interval = window.setInterval(() => void refreshEngine(), 20_000);
      window.addEventListener("focus", onFocus);
    }
    return () => {
      watchers -= 1;
      if (watchers === 0) {
        window.clearInterval(interval);
        window.removeEventListener("focus", onFocus);
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, getEngine, getEngine);
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code = "failed",
  ) {
    super(message);
  }
}

/** The engine answers long jobs as one JSON object per line, so progress arrives while it works. */
async function* readLines(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as Record<string, unknown>;
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as Record<string, unknown>;
}

async function failure(response: Response): Promise<EngineError> {
  let message = `Mesin Notula menolak permintaan (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // Not JSON. The status code is enough.
  }
  return new EngineError(message, response.status === 401 ? "needs_code" : "failed");
}

function unreachable(cause: unknown): never {
  if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
  if (cause instanceof EngineError) throw cause;
  throw new EngineError("Mesin Notula tidak bisa dihubungi. Pastikan mesin sedang berjalan di komputer.", "offline");
}

export interface EngineSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeOptions {
  language: Lang;
  /** The last words already transcribed, to keep names and terms consistent across chunks. */
  prompt?: string;
  /** True when `audio` is already 16 kHz mono WAV, which skips conversion on the engine. */
  wav16k?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: { stage: "convert" | "transcribe"; percent: number }) => void;
}

export async function engineTranscribe(audio: Blob, options: TranscribeOptions): Promise<{ segments: EngineSegment[]; durationSec: number }> {
  const engine = getEngine();
  if (engine.state !== "ready") throw new EngineError("Mesin Notula belum terhubung.", "offline");
  const query = new URLSearchParams({ lang: options.language });
  if (options.wav16k) query.set("format", "wav16k");
  try {
    const response = await fetch(`${engine.base}/api/transcribe?${query}`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": options.wav16k ? "audio/wav" : audio.type || "application/octet-stream",
        ...(options.prompt ? { "x-notula-prompt": encodeURIComponent(options.prompt.slice(-300)) } : {}),
      },
      body: audio,
      signal: options.signal,
    });
    if (!response.ok) throw await failure(response);
    for await (const event of readLines(response)) {
      if (event.type === "progress") options.onProgress?.({ stage: event.stage as "convert" | "transcribe", percent: Number(event.percent) || 0 });
      else if (event.type === "error") throw new EngineError(String(event.message ?? "Transkripsi gagal."), String(event.code ?? "failed"));
      else if (event.type === "result") return { segments: (event.segments as EngineSegment[]) ?? [], durationSec: Number(event.durationSec) || 0 };
    }
    throw new EngineError("Mesin berhenti sebelum transkripsi selesai.");
  } catch (cause) {
    unreachable(cause);
  }
}

export interface ClaudeRequest {
  system: string;
  prompt: string;
  /** JSON Schema that the answer must follow. */
  schema: object;
  images?: { base64: string; mediaType?: string }[];
  /** "sonnet", "opus", "haiku", or empty for Claude Code's default. */
  model?: string;
  signal?: AbortSignal;
  onProgress?: (characters: number) => void;
}

/** One structured answer from Claude, through Claude Code on the engine's computer. */
export async function engineClaude(request: ClaudeRequest): Promise<{ output: unknown; model: string }> {
  const engine = getEngine();
  if (engine.state !== "ready") throw new EngineError("Mesin Notula belum terhubung.", "offline");
  try {
    const response = await fetch(`${engine.base}/api/claude`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ system: request.system, prompt: request.prompt, schema: request.schema, images: request.images ?? [], model: request.model ?? "" }),
      signal: request.signal,
    });
    if (!response.ok) throw await failure(response);
    for await (const event of readLines(response)) {
      if (event.type === "progress") request.onProgress?.(Number(event.chars) || 0);
      else if (event.type === "error") throw new EngineError(String(event.message ?? "Claude gagal menjawab."), String(event.code ?? "failed"));
      else if (event.type === "result") {
        if (event.usage) set({ ...info, usage: event.usage as EngineUsage });
        return { output: event.output, model: String(event.model ?? "") };
      }
    }
    throw new EngineError("Mesin berhenti sebelum Claude selesai menjawab.");
  } catch (cause) {
    unreachable(cause);
  }
}

/** Pairing details for phones and tablets. Only the engine's own computer can read them. */
export async function enginePairing(): Promise<{ enabled: boolean; code: string; urls: string[] } | null> {
  const engine = getEngine();
  if (engine.state !== "ready") return null;
  try {
    const response = await fetch(`${engine.base}/api/pairing`, { headers: authHeaders(), signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    return (await response.json()) as { enabled: boolean; code: string; urls: string[] };
  } catch {
    return null;
  }
}

/** "claude-opus-5-5" -> "Claude Opus 5.5". */
export function modelDisplayName(model: string): string {
  const match = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(model);
  if (!match) return model === "claude.ai" ? "Claude" : model || "Claude";
  const family = match[1][0].toUpperCase() + match[1].slice(1);
  return `Claude ${family} ${match[2]}${match[3] ? `.${match[3]}` : ""}`;
}
