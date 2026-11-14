import { describe, expect, it } from "vitest";
import { buildHandoffPrompt, HandoffError, parseHandoffReply } from "../src/lib/handoff";
import { toMinutes } from "../src/lib/minutesPrompt";
import { buildSampleMeeting } from "../src/lib/sample";

const reply = {
  title: "Koordinasi peluncuran aplikasi",
  topic: "Kesiapan peluncuran",
  opening: "Rapat dibuka oleh Rina.",
  objectives: ["Menyepakati jadwal"],
  discussion: [{ heading: "Jadwal", summary: "Peluncuran mundur.", points: ["Mundur satu minggu"] }],
  decisions: ["Peluncuran tanggal 8"],
  actionItems: [{ task: "Kirim jadwal baru", owner: "Rina", due: "Jumat" }],
  summary: "Peluncuran disepakati mundur.",
  attendees: [{ name: "Rina Wulandari", role: "Manajer produk" }],
  imageCaptions: [],
};

describe("buildHandoffPrompt", () => {
  it("bundles instructions, reply format, and the transcript into one message", () => {
    const prompt = buildHandoffPrompt(buildSampleMeeting(new Date(2026, 10, 14)), "id");
    expect(prompt).toContain("Bahasa Indonesia");
    expect(prompt).toContain('"actionItems"');
    expect(prompt).toContain("<transcript>");
    expect(prompt).toContain("Pictures attached: 0");
  });

  it("refuses an empty transcript", () => {
    const empty = buildSampleMeeting();
    empty.segments = [];
    expect(() => buildHandoffPrompt(empty, "id")).toThrow(HandoffError);
  });
});

describe("parseHandoffReply", () => {
  it("reads a bare JSON object", () => {
    expect(parseHandoffReply(JSON.stringify(reply)).title).toBe(reply.title);
  });

  it("reads JSON inside a code block with chatter around it", () => {
    const raw = `Tentu, ini notulennya:\n\n\`\`\`json\n${JSON.stringify(reply, null, 2)}\n\`\`\`\n\nSemoga membantu.`;
    const result = parseHandoffReply(raw);
    expect(result.decisions).toEqual(["Peluncuran tanggal 8"]);
    expect(toMinutes(result, "claude.ai").source).toBe("ai");
  });

  it("fills in keys that Claude left out", () => {
    const { imageCaptions: _omit, attendees: _omit2, ...partial } = reply;
    const result = parseHandoffReply(JSON.stringify(partial));
    expect(result.attendees).toEqual([]);
    expect(result.imageCaptions).toEqual([]);
  });

  it("explains empty, missing, broken, and contentless replies", () => {
    expect(() => parseHandoffReply("  ")).toThrow(/Tempel jawaban/);
    expect(() => parseHandoffReply("tidak ada json di sini")).toThrow(/Tidak ada data notulen/);
    expect(() => parseHandoffReply('{"title": "terpotong')).toThrow(HandoffError);
    expect(() => parseHandoffReply("{}")).toThrow(/tidak berisi notulen/);
  });
});
