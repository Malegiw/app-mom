import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where the engine keeps things that outlive a run: the speech model, its access code, its certificate. */
export const DATA_DIR =
  process.env.NOTULA_DATA_DIR ||
  (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "Notula") : path.join(os.homedir(), ".notula"));

export const MODEL_PATH = process.env.NOTULA_WHISPER_MODEL || path.join(DATA_DIR, "models", "ggml-large-v3-turbo.bin");

export const PORT = Number(process.env.NOTULA_PORT || 8787);
export const LAN_PORT = Number(process.env.NOTULA_LAN_PORT || 8788);

/** Web addresses, besides this machine's own, that may call the engine from a browser. */
export const PUBLISHED_ORIGINS = (process.env.NOTULA_ALLOWED_ORIGINS || "https://malegiw.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const EXTRA_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local", "bin")];

/** Finds a program on PATH, then in the usual Homebrew and user folders, so a double-clicked launcher works too. */
export function findBinary(name) {
  const dirs = [...(process.env.PATH || "").split(path.delimiter), ...EXTRA_BIN_DIRS].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here. Keep looking.
    }
  }
  return null;
}

/** PATH for child processes: the caller's, plus the folders above. */
export function childPath() {
  return [...new Set([...(process.env.PATH || "").split(path.delimiter), ...EXTRA_BIN_DIRS])].filter(Boolean).join(path.delimiter);
}

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

/**
 * The code a phone or tablet must enter before it may use the engine over Wi-Fi.
 * Made once and kept, so paired devices stay paired across restarts.
 */
export function loadAccessCode() {
  ensureDataDir();
  const file = path.join(DATA_DIR, "engine.json");
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (typeof saved.accessCode === "string" && saved.accessCode.length >= 8) return saved.accessCode;
    } catch {
      // Unreadable file: fall through and write a fresh one.
    }
  }
  // Letters and digits that are hard to confuse when read off a screen.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const accessCode = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  writeFileSync(file, `${JSON.stringify({ accessCode }, null, 2)}\n`, { mode: 0o600 });
  return accessCode;
}

/** This machine's addresses on the local network, for the "open this on your phone" hint. */
export function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

export function localHostname() {
  const name = os.hostname();
  return name.endsWith(".local") ? name : `${name}.local`;
}
