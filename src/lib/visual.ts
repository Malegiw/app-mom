import { APP_NAME, BRAND, hex } from "./brand";
import { formatDate, formatDuration, formatTimeRange } from "./format";
import { canvasToBlob } from "./images";
import { PLATFORM_LABEL, type Meeting } from "./types";

/**
 * Draws the one-page visual summary: headline numbers, the flow of the discussion, and follow-ups
 * per owner. The result is a 16:9 PNG, shown in the app and placed into Word, Excel, and PowerPoint.
 */
export const VISUAL_WIDTH = 1600;
export const VISUAL_HEIGHT = 900;

const DISPLAY = '"Geist Variable", "Inter Variable", system-ui, sans-serif';
const BODY = '"Inter Variable", system-ui, sans-serif';

function font(ctx: CanvasRenderingContext2D, size: number, weight: 400 | 500 | 600 = 400, family = BODY) {
  ctx.font = `${weight} ${size}px ${family}`;
}

/** Breaks text into lines that fit `maxWidth`, ending the last allowed line with an ellipsis when cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const consumed = lines.join(" ").length;
  if (consumed < words.join(" ").length && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function hasVisualContent(meeting: Meeting): boolean {
  const minutes = meeting.minutes;
  return !!minutes && (minutes.discussion.length > 0 || minutes.actionItems.length > 0 || minutes.decisions.length > 0);
}

export function drawVisualSummary(canvas: HTMLCanvasElement, meeting: Meeting): void {
  const minutes = meeting.minutes;
  canvas.width = VISUAL_WIDTH;
  canvas.height = VISUAL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx || !minutes) return;
  const W = VISUAL_WIDTH;
  const H = VISUAL_HEIGHT;
  const PAD = 64;

  ctx.fillStyle = hex(BRAND.white);
  ctx.fillRect(0, 0, W, H);

  // Header band.
  ctx.fillStyle = hex(BRAND.blue);
  ctx.fillRect(0, 0, W, 190);
  ctx.fillStyle = hex(BRAND.orange);
  ctx.fillRect(0, 190, W, 8);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#c9dcee";
  font(ctx, 24, 400);
  ctx.fillText("Ringkasan rapat", PAD, 62);
  ctx.fillStyle = hex(BRAND.white);
  font(ctx, 46, 500, DISPLAY);
  const titleLines = wrap(ctx, meeting.title, W - PAD * 2, 1);
  ctx.fillText(titleLines[0] ?? "", PAD, 118);
  ctx.fillStyle = "#c9dcee";
  font(ctx, 24, 400);
  const sub = [formatDate(meeting.date), formatTimeRange(meeting), PLATFORM_LABEL[meeting.platform]].filter(Boolean).join("   |   ");
  ctx.fillText(sub, PAD, 160);

  // Headline numbers.
  const present = meeting.attendees.filter((a) => a.name.trim() && a.present).length;
  const stats: [string, string][] = [
    [meeting.durationSec > 0 ? formatDuration(meeting.durationSec) : "-", "Durasi"],
    [String(present), "Peserta hadir"],
    [String(minutes.decisions.length), "Keputusan"],
    [String(minutes.actionItems.length), "Tindak lanjut"],
  ];
  const statTop = 232;
  const statH = 126;
  const gap = 24;
  const statW = (W - PAD * 2 - gap * 3) / 4;
  stats.forEach(([value, label], index) => {
    const x = PAD + index * (statW + gap);
    roundRect(ctx, x, statTop, statW, statH, 20);
    ctx.fillStyle = hex(BRAND.brightWhite);
    ctx.fill();
    ctx.fillStyle = index === 3 ? hex(BRAND.orangeStrong) : hex(BRAND.blue);
    font(ctx, value.length > 8 ? 34 : 48, 500, DISPLAY);
    ctx.fillText(wrap(ctx, value, statW - 48, 1)[0] ?? value, x + 24, statTop + 66);
    ctx.fillStyle = hex(BRAND.textSecondary);
    font(ctx, 22, 400);
    ctx.fillText(label, x + 24, statTop + 102);
  });

  // Two columns: the flow of the discussion, and follow-ups per owner.
  const colTop = 408;
  const colGap = 56;
  const leftW = Math.round((W - PAD * 2 - colGap) * 0.56);
  const rightX = PAD + leftW + colGap;
  const rightW = W - PAD - rightX;
  const colBottom = H - 76;

  ctx.fillStyle = hex(BRAND.ink);
  font(ctx, 28, 500, DISPLAY);
  ctx.fillText("Alur pembahasan", PAD, colTop + 8);
  ctx.fillText(minutes.actionItems.length > 0 ? "Tindak lanjut per penanggung jawab" : "Keputusan utama", rightX, colTop + 8);

  // Left: numbered flow.
  const flow = [
    ...minutes.discussion.map((item) => item.heading || item.summary).filter(Boolean),
  ];
  const maxFlow = 6;
  const shownFlow = flow.slice(0, flow.length > maxFlow ? maxFlow - 1 : maxFlow);
  const hiddenFlow = flow.length - shownFlow.length;
  const flowTop = colTop + 44;
  const rowH = Math.min(70, (colBottom - flowTop) / Math.max(1, shownFlow.length + (hiddenFlow > 0 ? 1 : 0)));
  const dotX = PAD + 22;
  if (shownFlow.length > 1 || hiddenFlow > 0) {
    ctx.strokeStyle = hex(BRAND.border);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(dotX, flowTop + rowH / 2);
    ctx.lineTo(dotX, flowTop + rowH * (shownFlow.length + (hiddenFlow > 0 ? 1 : 0)) - rowH / 2);
    ctx.stroke();
  }
  shownFlow.forEach((heading, index) => {
    const cy = flowTop + rowH * index + rowH / 2;
    ctx.beginPath();
    ctx.arc(dotX, cy, 22, 0, Math.PI * 2);
    ctx.fillStyle = hex(BRAND.blue);
    ctx.fill();
    ctx.fillStyle = hex(BRAND.white);
    font(ctx, 22, 500);
    ctx.textAlign = "center";
    ctx.fillText(String(index + 1), dotX, cy + 8);
    ctx.textAlign = "left";
    ctx.fillStyle = hex(BRAND.ink);
    font(ctx, 24, 400);
    const lines = wrap(ctx, heading, leftW - 76, 2);
    const startY = cy + 8 - (lines.length - 1) * 15;
    lines.forEach((line, i) => ctx.fillText(line, PAD + 64, startY + i * 30));
  });
  if (hiddenFlow > 0) {
    const cy = flowTop + rowH * shownFlow.length + rowH / 2;
    ctx.beginPath();
    ctx.arc(dotX, cy, 22, 0, Math.PI * 2);
    ctx.fillStyle = hex(BRAND.blueSoft);
    ctx.fill();
    ctx.fillStyle = hex(BRAND.textSecondary);
    font(ctx, 24, 400);
    ctx.fillText(`dan ${hiddenFlow} pembahasan lain`, PAD + 64, cy + 8);
  }
  if (flow.length === 0) {
    ctx.fillStyle = hex(BRAND.textMuted);
    font(ctx, 24, 400);
    ctx.fillText("Belum ada pembahasan yang dicatat.", PAD, flowTop + 40);
  }

  // Right: bars per owner, or the top decisions when there are no follow-ups.
  const listTop = colTop + 44;
  if (minutes.actionItems.length > 0) {
    const counts = new Map<string, number>();
    for (const item of minutes.actionItems) {
      const owner = item.owner.trim() || "Belum ditentukan";
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const maxOwners = 6;
    const owners = sorted.slice(0, sorted.length > maxOwners ? maxOwners - 1 : maxOwners);
    const rest = sorted.slice(owners.length).reduce((sum, [, count]) => sum + count, 0);
    if (rest > 0) owners.push(["Lainnya", rest]);
    const peak = Math.max(...owners.map(([, count]) => count));
    const barRow = Math.min(70, (colBottom - listTop) / owners.length);
    const barMax = rightW - 64;
    owners.forEach(([owner, count], index) => {
      const y = listTop + barRow * index;
      ctx.fillStyle = hex(BRAND.ink);
      font(ctx, 22, 400);
      ctx.fillText(wrap(ctx, owner, rightW - 20, 1)[0] ?? owner, rightX, y + 24);
      const width = Math.max(14, (count / peak) * barMax);
      roundRect(ctx, rightX, y + 36, width, 18, 9);
      ctx.fillStyle = hex(BRAND.orange);
      ctx.fill();
      ctx.fillStyle = hex(BRAND.ink);
      font(ctx, 22, 500);
      ctx.fillText(String(count), rightX + width + 14, y + 53);
    });
  } else {
    const decisions = minutes.decisions.slice(0, 4);
    let y = listTop + 16;
    decisions.forEach((decision) => {
      ctx.fillStyle = hex(BRAND.orange);
      roundRect(ctx, rightX, y - 4, 8, 52, 4);
      ctx.fill();
      ctx.fillStyle = hex(BRAND.ink);
      font(ctx, 22, 400);
      wrap(ctx, decision, rightW - 30, 2).forEach((line, i) => ctx.fillText(line, rightX + 26, y + 18 + i * 28));
      y += 84;
    });
    if (decisions.length === 0) {
      ctx.fillStyle = hex(BRAND.textMuted);
      font(ctx, 24, 400);
      ctx.fillText("Belum ada keputusan yang dicatat.", rightX, listTop + 40);
    }
  }

  // Footer.
  ctx.fillStyle = hex(BRAND.border);
  ctx.fillRect(PAD, H - 58, W - PAD * 2, 2);
  ctx.fillStyle = hex(BRAND.textMuted);
  font(ctx, 20, 400);
  ctx.fillText(`Dibuat dengan ${APP_NAME}`, PAD, H - 24);
  if (minutes.topic) {
    ctx.textAlign = "right";
    ctx.fillText(wrap(ctx, `Topik: ${minutes.topic}`, W - PAD * 2 - 260, 1)[0] ?? "", W - PAD, H - 24);
    ctx.textAlign = "left";
  }
}

export async function renderVisualSummary(meeting: Meeting): Promise<Blob | null> {
  if (!hasVisualContent(meeting)) return null;
  // Wait for the web fonts so the picture does not fall back to a system face.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
  }
  const canvas = document.createElement("canvas");
  drawVisualSummary(canvas, meeting);
  return canvasToBlob(canvas, "image/png");
}
