import { execFile, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { childPath, DATA_DIR, findBinary } from "./config.mjs";

/**
 * Runs one request through Claude Code in print mode (`claude -p`), which signs in with the Claude
 * subscription of whoever owns this computer. The person's own plan pays for it; there is no API key.
 *
 * Claude gets no tools here: it reads the transcript and pictures it is handed and returns one
 * structured answer. It cannot touch files, run commands, or browse.
 */

/**
 * Variables that would change who pays or where requests go. An ANTHROPIC_API_KEY in the shell would
 * silently bill the API instead of the subscription, so none of these reach the child process.
 */
function cleanEnv() {
  const env = { ...process.env, PATH: childPath() };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/.test(key)) delete env[key];
  }
  return env;
}

/** An empty folder to run in, so no project settings, hooks, or instructions get picked up. */
function workDir() {
  const dir = path.join(DATA_DIR, "claude-workdir");
  mkdirSync(dir, { recursive: true });
  return dir;
}

let statusCache = { at: 0, value: null };

/** Whether Claude Code is installed and signed in, and on which plan. Cached for a minute. */
export function claudeStatus() {
  const bin = findBinary("claude");
  if (!bin) return Promise.resolve({ installed: false, loggedIn: false, plan: "" });
  if (statusCache.value && Date.now() - statusCache.at < 60_000) return Promise.resolve(statusCache.value);
  return new Promise((resolve) => {
    execFile(bin, ["auth", "status"], { env: cleanEnv(), timeout: 15_000 }, (_error, stdout) => {
      let value = { installed: true, loggedIn: false, plan: "" };
      try {
        const parsed = JSON.parse(stdout);
        // Only the plan name leaves this function. The account's email stays out of every response.
        value = { installed: true, loggedIn: Boolean(parsed.loggedIn), plan: String(parsed.subscriptionType ?? "") };
      } catch {
        // Older versions print plain text. Treat that as "installed, sign-in unknown".
      }
      statusCache = { at: Date.now(), value };
      resolve(value);
    });
  });
}

let lastUsage = null;
/** How much of the plan's allowance is used, as reported by the most recent run. */
export const lastKnownUsage = () => lastUsage;

function readUsage(info) {
  const windows = info?.unifiedWindows ?? {};
  return {
    status: info?.status ?? "unknown",
    fiveHour: typeof windows.five_hour?.utilization === "number" ? windows.five_hour.utilization : null,
    sevenDay: typeof windows.seven_day?.utilization === "number" ? windows.seven_day.utilization : null,
    resetsAt: typeof info?.resetsAt === "number" ? info.resetsAt * 1000 : null,
    at: Date.now(),
  };
}

const MODEL_ALIASES = new Set(["sonnet", "opus", "haiku", "fable"]);

/**
 * @param {{ system: string, prompt: string, schema: object, images?: { base64: string, mediaType?: string }[], model?: string, signal?: AbortSignal, onProgress?: (chars: number) => void }} request
 */
export function runClaude({ system, prompt, schema, images = [], model = "", signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const bin = findBinary("claude");
    if (!bin) {
      reject(Object.assign(new Error("Claude Code belum terpasang di komputer ini."), { code: "claude_missing" }));
      return;
    }

    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--setting-sources", "project",
      "--system-prompt", system,
      "--json-schema", JSON.stringify(schema),
    ];
    if (MODEL_ALIASES.has(model)) args.push("--model", model);

    const child = spawn(bin, args, { cwd: workDir(), env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });

    const content = [];
    images.forEach((image, index) => {
      content.push({ type: "text", text: `Picture ${index + 1}:` });
      content.push({ type: "image", source: { type: "base64", media_type: image.mediaType || "image/jpeg", data: image.base64 } });
    });
    content.push({ type: "text", text: prompt });
    child.stdin.on("error", () => undefined);
    child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);

    let buffer = "";
    let stderrTail = "";
    let result = null;
    let usedModel = "";
    let written = 0;
    let limited = null;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(Object.assign(new Error("Dibatalkan."), { code: "aborted" }));
    };
    signal?.addEventListener("abort", abort, { once: true });
    // A very long meeting can take several minutes. Past this, something is stuck.
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(Object.assign(new Error("Claude tidak menjawab dalam 20 menit. Coba lagi."), { code: "timeout" }));
    }, 20 * 60_000);

    const onEvent = (event) => {
      if (event.type === "system" && event.subtype === "init") usedModel = event.model ?? "";
      else if (event.type === "rate_limit_event") {
        lastUsage = readUsage(event.rate_limit_info);
        if (event.rate_limit_info?.status && event.rate_limit_info.status !== "allowed" && event.rate_limit_info.status !== "allowed_warning") limited = lastUsage;
      } else if (event.type === "stream_event") {
        const delta = event.event?.delta;
        const piece = delta?.partial_json ?? delta?.text ?? "";
        if (piece) {
          written += piece.length;
          onProgress?.(written);
        }
      } else if (event.type === "result") result = event;
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          // Not a JSON line. Ignore it.
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-1500);
    });
    child.on("error", (error) => finish(error));
    child.on("close", () => {
      if (result && !result.is_error && result.structured_output) {
        finish(null, { output: result.structured_output, model: usedModel, usage: lastUsage });
        return;
      }
      const detail = String(result?.result ?? stderrTail ?? "").trim();
      if (limited || /usage limit|rate limit|limit reached/i.test(detail)) {
        const when = limited?.resetsAt ? ` Kuota terbuka lagi sekitar pukul ${new Date(limited.resetsAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}.` : "";
        finish(Object.assign(new Error(`Batas pemakaian langganan Claude tercapai.${when}`), { code: "rate_limited" }));
      } else if (/not logged in|\/login|authentication|invalid api key|oauth/i.test(detail)) {
        finish(Object.assign(new Error("Claude Code belum masuk ke akun Claude. Buka Terminal, jalankan `claude`, lalu ketik /login."), { code: "not_logged_in" }));
      } else if (result && !result.is_error) {
        finish(Object.assign(new Error("Claude tidak mengembalikan notulen yang lengkap. Coba buat ulang."), { code: "no_output" }));
      } else {
        finish(Object.assign(new Error(`Claude Code gagal menjawab. ${detail.slice(0, 300)}`.trim()), { code: "failed" }));
      }
    });
  });
}
