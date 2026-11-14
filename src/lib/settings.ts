import { useSyncExternalStore } from "react";
import type { Lang } from "./types";

export interface Settings {
  /** Claude API key. Kept in this browser only and sent only to api.anthropic.com. */
  anthropicKey: string;
  model: string;
  /** ElevenLabs API key for turning recorded audio into text. Optional. */
  elevenLabsKey: string;
  language: Lang;
  organization: string;
  notetaker: string;
}

export const MODEL_OPTIONS = [
  { value: "claude-opus-5-5", label: "Claude Opus 5.5 (paling teliti)" },
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (seimbang)" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5 (paling hemat)" },
];

const DEFAULTS: Settings = {
  anthropicKey: "",
  model: "claude-opus-5-5",
  elevenLabsKey: "",
  language: "id",
  organization: "",
  notetaker: "",
};

const KEY = "notula.settings.v1";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}

export function getSettings(): Settings {
  return read();
}

export function saveSettings(patch: Partial<Settings>): void {
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private windows can refuse storage. The settings still apply until the tab closes.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
