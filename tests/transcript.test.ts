import { describe, expect, it } from "vitest";
import { wordsToSegments } from "../src/lib/stt";
import { parseTranscript, segmentsToText, uniqueSpeakers, lastTimestamp } from "../src/lib/transcript";

describe("parseTranscript", () => {
  it("reads a Teams WebVTT file with voice tags and merges turns from one speaker", () => {
    const vtt = `WEBVTT

00:00:03.120 --> 00:00:06.000
<v Rina Wulandari>Selamat pagi semuanya.</v>

00:00:06.100 --> 00:00:09.500
<v Rina Wulandari>Kita mulai rapatnya.</v>

00:00:10.000 --> 00:00:14.000
<v Bagus Pratama>Baik, fitur pembayaran sudah selesai.</v>
`;
    const segments = parseTranscript(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ speaker: "Rina Wulandari", start: 3.12, text: "Selamat pagi semuanya. Kita mulai rapatnya." });
    expect(segments[1]).toMatchObject({ speaker: "Bagus Pratama", start: 10 });
    expect(uniqueSpeakers(segments)).toEqual(["Rina Wulandari", "Bagus Pratama"]);
    expect(lastTimestamp(segments)).toBe(10);
  });

  it("reads a Zoom WebVTT file with numbered cues and Name: prefixes", () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Andi Nugroho: Saya sudah dapat dua belas peserta.

2
00:01:05.000 --> 00:01:08.000
Sari Dewi: Skenarionya harus mencakup pembayaran.
`;
    const segments = parseTranscript(vtt);
    expect(segments.map((s) => s.speaker)).toEqual(["Andi Nugroho", "Sari Dewi"]);
    expect(segments[1].start).toBe(65);
    expect(segments[0].text).toBe("Saya sudah dapat dua belas peserta.");
  });

  it("reads SRT with comma milliseconds and an hour field", () => {
    const srt = `1
01:00:02,500 --> 01:00:05,000
Halo, apa kabar?

2
01:00:06,000 --> 01:00:08,000
Baik, terima kasih.`;
    const segments = parseTranscript(srt);
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(3602.5);
    expect(segments[0].text).toBe("Halo, apa kabar? Baik, terima kasih.");
  });

  it("reads the Teams Word layout, where the speaker sits on its own line", () => {
    const text = `0:0:0.0 --> 0:0:3.5
Rina Wulandari
Selamat pagi.
0:0:4.0 --> 0:0:8.0
Bagus Pratama
Pagi, saya siap.`;
    const segments = parseTranscript(text, { nameOnOwnLine: true });
    expect(segments.map((s) => [s.speaker, s.text])).toEqual([
      ["Rina Wulandari", "Selamat pagi."],
      ["Bagus Pratama", "Pagi, saya siap."],
    ]);
  });

  it("reads plain text with optional times and speakers, and keeps unlabelled lines", () => {
    const text = `[00:12] Rina: Kita mulai dari agenda pertama.
Bagus: Siap.
Catatan tanpa pembicara, misalnya pukul 10:30 istirahat.`;
    const segments = parseTranscript(text);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ speaker: "Rina", start: 12, text: "Kita mulai dari agenda pertama." });
    expect(segments[1]).toMatchObject({ speaker: "Bagus", start: null });
    expect(segments[2].speaker).toBe("");
    expect(segments[2].text).toContain("pukul 10:30");
  });

  it("does not mistake a URL or a long sentence with a colon for a speaker", () => {
    const segments = parseTranscript("Lihat https://contoh.id/rapat untuk detailnya.\nIni kalimat panjang yang menjelaskan sesuatu dengan rinci sekali: lalu ada lanjutannya.");
    expect(segments.every((s) => s.speaker === "")).toBe(true);
  });

  it("formats segments back to text", () => {
    const text = segmentsToText([{ id: "1", start: 75, speaker: "Rina", text: "Halo." }, { id: "2", start: null, speaker: "", text: "Catatan." }]);
    expect(text).toBe("[01:15] Rina: Halo.\nCatatan.");
  });
});

describe("wordsToSegments", () => {
  it("groups words by speaker and labels speakers in order of appearance", () => {
    const words = [
      { text: "Selamat", type: "word" as const, start: 0, end: 0.4, speaker_id: "speaker_0" },
      { text: " ", type: "spacing" as const },
      { text: "pagi.", type: "word" as const, start: 0.5, end: 0.9, speaker_id: "speaker_0" },
      { text: " ", type: "spacing" as const },
      { text: "(tertawa)", type: "audio_event" as const, start: 1, end: 1.5 },
      { text: "Pagi", type: "word" as const, start: 2, end: 2.3, speaker_id: "speaker_1" },
      { text: " ", type: "spacing" as const },
      { text: "juga.", type: "word" as const, start: 2.4, end: 2.8, speaker_id: "speaker_1" },
    ];
    const segments = wordsToSegments(words);
    expect(segments.map((s) => [s.speaker, s.text, s.start])).toEqual([
      ["Pembicara 1", "Selamat pagi.", 0],
      ["Pembicara 2", "Pagi juga.", 2],
    ]);
  });
});

describe("line labels", () => {
  it("keeps labels such as Catatan as text, not as a speaker", () => {
    const segments = parseTranscript("Catatan: rapat berikutnya hari Senin.\nTindak lanjut: kirim laporan.");
    expect(segments.every((s) => s.speaker === "")).toBe(true);
    expect(segments.map((s) => s.text)).toEqual(["Catatan: rapat berikutnya hari Senin.", "Tindak lanjut: kirim laporan."]);
  });
});
