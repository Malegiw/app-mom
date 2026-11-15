#!/usr/bin/env node
/**
 * The Notula engine: a small server that runs on the computer that owns the Claude subscription.
 *
 *   - Speech to text with whisper.cpp, on this machine.
 *   - Minutes and pictures from Claude Code (`claude -p`), on the owner's Claude plan.
 *   - The built web app itself, so opening http://localhost:8787 is all it takes.
 *
 * By default it listens on this computer only. With --lan it also listens on the local network
 * over HTTPS, behind an access code, so a phone or tablet on the same Wi-Fi can use it.
 * With --tailscale it also answers requests that arrive through Tailscale (`tailscale serve`),
 * again behind the access code, so a phone or tablet can use it from anywhere.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { loadCertificate } from "./cert.mjs";
import { claudeStatus, lastKnownUsage, runClaude } from "./claude.mjs";
import { LAN_PORT, lanAddresses, loadAccessCode, localHostname, PORT, PUBLISHED_ORIGINS } from "./config.mjs";
import { tailscaleInfo } from "./tailscale.mjs";
import { transcribeFile, warmUp, whisperStatus } from "./whisper.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const LAN = process.argv.includes("--lan") || process.env.NOTULA_LAN === "1";
const TMP = mkdtempSync(path.join(os.tmpdir(), "notula-"));
const TAILSCALE = process.argv.includes("--tailscale") || process.env.NOTULA_TAILSCALE === "1";
const TS = TAILSCALE ? await tailscaleInfo() : { hosts: [], owner: "" };
const TS_HOSTS = new Set(TS.hosts);
const ACCESS_CODE = LAN || TAILSCALE ? loadAccessCode() : "";

const MAX_AUDIO_BYTES = 2 * 1024 ** 3;
const MAX_JSON_BYTES = 64 * 1024 ** 2;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const hostnameOf = (host = "") => host.replace(/:\d+$/, "").toLowerCase();
const networkNames = () => new Set([localHostname().toLowerCase(), os.hostname().toLowerCase(), ...lanAddresses()]);

/**
 * A browser on any website can try to reach a server on this computer. Checking the Host header
 * stops a hostile page from pointing its own domain name at this machine, and checking Origin stops
 * other sites from calling the engine at all.
 */
function hostAllowed(req, mode) {
  const name = hostnameOf(req.headers.host);
  if (mode === "tailscale") return TS_HOSTS.has(name);
  return LOOPBACK.has(name) || (mode === "lan" && networkNames().has(name));
}

function originAllowed(origin, mode) {
  if (PUBLISHED_ORIGINS.includes(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Pages served from this computer: the engine itself, or a development server.
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return true;
  // The app as this engine serves it over Wi-Fi.
  if (mode === "tailscale") return url.protocol === "https:" && TS_HOSTS.has(url.hostname);
  return mode === "lan" && url.protocol === "https:" && networkNames().has(url.hostname) && Number(url.port) === LAN_PORT;
}

const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * `tailscale serve` forwards requests from this computer and stamps each with the Tailscale account
 * of the sender. Tailscale sets that header itself, so for a request that really came through serve
 * it names the person who is signed in on the device. Only the engine's owner is let in this way.
 */
function ownerIdentified(req, mode) {
  if (mode !== "tailscale" || !TS.owner || !LOCAL_ADDRESSES.has(req.socket.remoteAddress ?? "")) return false;
  return String(req.headers["tailscale-user-login"] ?? "").trim().toLowerCase() === TS.owner;
}

function codeMatches(header = "") {
  const given = Buffer.from(header.replace(/^Bearer\s+/i, "").trim().toUpperCase());
  const expected = Buffer.from(ACCESS_CODE);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Ten wrong codes from one address locks that address out for five minutes.
const failures = new Map();
function tooManyFailures(address) {
  const entry = failures.get(address);
  return Boolean(entry && entry.count >= 10 && Date.now() - entry.at < 5 * 60_000);
}
function noteFailure(address) {
  const entry = failures.get(address);
  if (!entry || Date.now() - entry.at > 5 * 60_000) failures.set(address, { count: 1, at: Date.now() });
  else entry.count += 1;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** One JSON object per line, so progress can reach the page while the work is still running. */
function startStream(res) {
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
  return (event) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
}

function abortWhenClosed(res) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller;
}

function limitBytes(max) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length;
      callback(seen > max ? Object.assign(new Error("Berkas terlalu besar."), { code: "too_large" }) : null, chunk);
    },
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error("Permintaan terlalu besar."), { code: "too_large" });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const AUDIO_EXTENSIONS = { "audio/webm": ".webm", "video/webm": ".webm", "audio/mp4": ".m4a", "video/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/ogg": ".ogg", "video/quicktime": ".mov" };

async function handleTranscribe(req, res, url) {
  const requested = url.searchParams.get("lang");
  const language = requested === "en" || requested === "auto" ? requested : "id";
  const isWav16k = url.searchParams.get("format") === "wav16k";
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const file = path.join(TMP, `${randomUUID()}${isWav16k ? ".wav" : (AUDIO_EXTENSIONS[type] ?? ".bin")}`);
  let prompt = "";
  try {
    prompt = decodeURIComponent(String(req.headers["x-notula-prompt"] ?? ""));
  } catch {
    prompt = "";
  }

  try {
    await pipeline(req, limitBytes(MAX_AUDIO_BYTES), createWriteStream(file));
  } catch (error) {
    await rm(file, { force: true });
    sendJson(res, error.code === "too_large" ? 413 : 400, { error: error.code === "too_large" ? "Berkas terlalu besar." : "Unggahan terputus." });
    return;
  }

  const write = startStream(res);
  const controller = abortWhenClosed(res);
  try {
    const result = await transcribeFile(file, { language, prompt, isWav16k, signal: controller.signal, onProgress: (progress) => write({ type: "progress", ...progress }) });
    write({ type: "result", ...result });
  } catch (error) {
    if (error.code !== "aborted") write({ type: "error", code: error.code ?? "failed", message: error.message });
  } finally {
    await rm(file, { force: true });
    res.end();
  }
}

async function handleClaude(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendJson(res, error.code === "too_large" ? 413 : 400, { error: "Permintaan tidak bisa dibaca." });
    return;
  }
  const images = Array.isArray(body.images) ? body.images.filter((image) => image && typeof image.base64 === "string").slice(0, 12) : [];
  if (typeof body.system !== "string" || typeof body.prompt !== "string" || !body.schema || typeof body.schema !== "object") {
    sendJson(res, 400, { error: "Permintaan tidak lengkap." });
    return;
  }

  const write = startStream(res);
  const controller = abortWhenClosed(res);
  try {
    const result = await runClaude({
      system: body.system,
      prompt: body.prompt,
      schema: body.schema,
      images,
      model: typeof body.model === "string" ? body.model : "",
      signal: controller.signal,
      onProgress: (chars) => write({ type: "progress", chars }),
    });
    write({ type: "result", ...result });
  } catch (error) {
    if (error.code !== "aborted") write({ type: "error", code: error.code ?? "failed", message: error.message });
  } finally {
    res.end();
  }
}

function lanUrls() {
  const wifi = LAN ? [`https://${localHostname()}:${LAN_PORT}`, ...lanAddresses().map((address) => `https://${address}:${LAN_PORT}`)] : [];
  return [...[...TS_HOSTS].map((host) => `https://${host}`), ...wifi];
}

async function handleHealth(res, { authorized }) {
  const base = { ok: true, name: "notula-engine", version: VERSION, needsCode: !authorized };
  if (!authorized) {
    sendJson(res, 200, base);
    return;
  }
  sendJson(res, 200, { ...base, whisper: whisperStatus(), claude: await claudeStatus(), usage: lastKnownUsage(), lan: { enabled: LAN || TAILSCALE } });
}

/**
 * The published site uses a service worker so it opens offline. Served from the engine that would
 * only get in the way: the engine has to be running anyway, and a cached copy would hide a rebuilt
 * app. So here the worker's address answers with one that removes itself and its caches.
 */
const RETIRE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
`;

function serveStatic(req, res, url) {
  if (url.pathname === "/sw.js" || url.pathname === "/registerSW.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(url.pathname === "/sw.js" ? RETIRE_WORKER : "// No offline copy when the app is served by the engine.\n");
    return;
  }
  if (!existsSync(path.join(DIST, "index.html"))) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("Aplikasi belum dibangun. Jalankan `npm run build`, lalu muat ulang halaman ini.\n");
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    relative = "/";
  }
  if (relative.endsWith("/")) relative += "index.html";
  const file = path.normalize(path.join(DIST, relative));
  if (!file.startsWith(DIST + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Tidak ditemukan.\n");
    return;
  }
  const hashed = relative.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "content-length": statSync(file).size,
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}

function makeHandler(mode) {
  const lan = mode !== "local";
  return async (req, res) => {
    try {
      if (!hostAllowed(req, mode)) {
        res.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
        res.end("Alamat ini bukan milik mesin Notula.\n");
        return;
      }
      const url = new URL(req.url ?? "/", "http://engine.invalid");
      const isApi = url.pathname.startsWith("/api/");
      const origin = req.headers.origin;

      if (origin) {
        if (!originAllowed(origin, mode)) {
          sendJson(res, 403, { error: "Situs ini tidak diizinkan memakai mesin Notula." });
          return;
        }
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-headers", "content-type, authorization, x-notula-prompt");
        res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
        res.setHeader("access-control-max-age", "600");
        // Chrome asks before a public site may reach a server on this computer or network.
        if (req.headers["access-control-request-private-network"]) res.setHeader("access-control-allow-private-network", "true");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!isApi) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405);
          res.end();
          return;
        }
        serveStatic(req, res, url);
        return;
      }

      // Over Wi-Fi every request needs the access code. On this computer itself, none is needed.
      // Behind `tailscale serve` every request comes from this computer, so the real sender is in X-Forwarded-For.
      const forwarded = mode === "tailscale" ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
      const address = forwarded || (req.socket.remoteAddress ?? "");
      let authorized = !lan;
      if (lan) {
        if (tooManyFailures(address)) {
          sendJson(res, 429, { error: "Terlalu banyak kode salah. Coba lagi lima menit lagi." });
          return;
        }
        authorized = ownerIdentified(req, mode) || codeMatches(req.headers.authorization);
        if (!authorized && req.headers.authorization) noteFailure(address);
      }

      if (url.pathname === "/api/health" && req.method === "GET") {
        await handleHealth(res, { authorized });
        return;
      }
      if (!authorized) {
        sendJson(res, 401, { error: "Kode akses mesin diperlukan.", needsCode: true });
        return;
      }
      if (url.pathname === "/api/pairing" && req.method === "GET") {
        // Shown in the app's settings on this computer, so a phone can be paired without the terminal.
        if (lan) sendJson(res, 403, { error: "Hanya tersedia di komputer mesin." });
        else sendJson(res, 200, { enabled: LAN || TAILSCALE, code: ACCESS_CODE, urls: lanUrls() });
        return;
      }
      if (url.pathname === "/api/transcribe" && req.method === "POST") {
        await handleTranscribe(req, res, url);
        return;
      }
      if (url.pathname === "/api/claude" && req.method === "POST") {
        await handleClaude(req, res);
        return;
      }
      sendJson(res, 404, { error: "Tidak ditemukan." });
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: "Mesin mengalami kesalahan." });
      else res.end();
      console.error("[notula]", error);
    }
  };
}

function cleanup() {
  rmSync(TMP, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));

const localHandler = makeHandler("local");
const tailscaleHandler = makeHandler("tailscale");
const local = createHttpServer((req, res) => (TAILSCALE && TS_HOSTS.has(hostnameOf(req.headers.host)) ? tailscaleHandler(req, res) : localHandler(req, res)));
local.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Port ${PORT} sedang dipakai. Mesin Notula mungkin sudah berjalan: buka http://localhost:${PORT}`);
  else console.error(error.message);
  process.exit(1);
});
local.listen(PORT, "127.0.0.1", async () => {
  const whisper = whisperStatus();
  const claude = await claudeStatus();
  console.log(`\nMesin Notula ${VERSION} berjalan.`);
  console.log(`  Buka di komputer ini : http://localhost:${PORT}`);
  console.log(`  Transkripsi (Whisper): ${whisper.ready ? "siap" : whisper.installed ? "model belum diunduh" : "whisper.cpp belum terpasang"}`);
  console.log(`  Claude Code          : ${!claude.installed ? "belum terpasang" : claude.loggedIn ? `masuk, paket ${claude.plan || "tidak diketahui"}` : "belum masuk (jalankan `claude`, lalu /login)"}`);
  if (TAILSCALE) {
    if (TS_HOSTS.size === 0) console.log("  Dari mana saja       : Tailscale tidak ditemukan atau belum masuk. Pasang dan masuk ke Tailscale, lalu jalankan ulang.");
    else {
      for (const host of TS_HOSTS) console.log(`  Dari mana saja       : https://${host}`);
      console.log(`  Kode akses           : ${ACCESS_CODE}`);
      console.log(`  Jika alamat itu belum menjawab, jalankan sekali: tailscale serve --bg ${PORT}`);
    }
  }
  if (!LAN && !TAILSCALE) console.log("  HP dan iPad          : mati. Jalankan dengan --lan (Wi-Fi) atau --tailscale (dari mana saja).");
  void warmUp();
});

if (LAN) {
  try {
    const secure = createHttpsServer(loadCertificate(), makeHandler("lan"));
    secure.on("error", (error) => console.error(`Sambungan Wi-Fi gagal dinyalakan: ${error.message}`));
    secure.listen(LAN_PORT, "0.0.0.0", () => {
      console.log("  HP dan iPad (Wi-Fi yang sama):");
      for (const address of lanUrls()) console.log(`    ${address}`);
      console.log(`  Kode akses           : ${ACCESS_CODE}`);
      console.log("  Browser di HP akan memperingatkan soal sertifikat. Pilih lanjutkan: sambungannya tetap terenkripsi.");
    });
  } catch (error) {
    console.error(`Sambungan Wi-Fi gagal dinyalakan: ${error.message}`);
  }
}
