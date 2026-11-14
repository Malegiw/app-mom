import { mkdirSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import sharp from "sharp";
import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import type { ExportBundle, ExportImage } from "../src/lib/export/common";
import { buildDocx } from "../src/lib/export/docx";
import { buildPptx } from "../src/lib/export/pptx";
import { buildWorkbook } from "../src/lib/export/xlsx";
import { buildSampleMeeting } from "../src/lib/sample";

// Real PNGs made with sharp, standing in for the pictures a browser canvas would supply.
async function image(name: string, caption: string, color: string, width: number, height: number): Promise<ExportImage> {
  const png = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  return { name, caption, dataUrl: `data:image/png;base64,${png.toString("base64")}`, width, height, type: "png" };
}

const OUT = process.env.NOTULA_EXPORT_DIR;
const save = (name: string, data: Uint8Array | Buffer) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}`, data);
};

const bundle = async (): Promise<ExportBundle> => ({
  meeting: buildSampleMeeting(new Date(2026, 10, 14)),
  images: [await image("papan-tulis.png", "Sketsa jadwal di papan tulis", "#fe5000", 1200, 675)],
  visual: await image("ringkasan.png", "Ringkasan visual rapat", "#0f4c81", 1600, 900),
  organization: "PT Contoh Sejahtera",
});

async function parts(data: Uint8Array | Buffer | ArrayBuffer) {
  const zip = await JSZip.loadAsync(data);
  return { zip, names: Object.keys(zip.files).filter((name) => !name.endsWith("/")) };
}

describe("exports", () => {
  it("builds a Word document with every section, the pictures, and the transcript", async () => {
    const buffer = await Packer.toBuffer(buildDocx(await bundle()));
    save("contoh.docx", buffer);
    const { zip, names } = await parts(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const heading of ["Pembukaan", "Tujuan", "Isi pembahasan", "Keputusan", "Tindak lanjut", "Rangkuman", "Ringkasan visual", "Dokumentasi", "Daftar hadir", "Lampiran: transkrip"]) {
      expect(xml).toContain(heading);
    }
    expect(xml).toContain("Koordinasi peluncuran aplikasi pemesanan versi 2");
    expect(xml).toContain("Dimas Saputra");
    expect(xml).toContain("Tidak hadir");
    expect(names.filter((name) => name.startsWith("word/media/"))).toHaveLength(2);
  });

  it("builds a Word document for a meeting that has no minutes yet", async () => {
    const data = await bundle();
    data.meeting.minutes = null;
    data.visual = null;
    const buffer = await Packer.toBuffer(buildDocx(data));
    const { zip } = await parts(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Notulen belum dibuat");
    expect(xml).not.toContain("Isi pembahasan");
    expect(xml).toContain("Lampiran: transkrip");
  });

  it("builds an Excel workbook with one sheet per record type", async () => {
    const workbook = buildWorkbook(await bundle());
    const buffer = await workbook.xlsx.writeBuffer();
    save("contoh.xlsx", Buffer.from(buffer));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Ringkasan", "Pembahasan", "Keputusan", "Tindak lanjut", "Daftar hadir", "Transkrip", "Gambar"]);
    const actions = workbook.getWorksheet("Tindak lanjut")!;
    expect(actions.rowCount).toBe(7);
    expect(actions.getCell("B2").value).toBe("Menyelesaikan fitur notifikasi");
    expect(actions.getCell("C2").value).toBe("Bagus Pratama");
    expect(workbook.getWorksheet("Daftar hadir")!.rowCount).toBe(6);
    expect(workbook.getWorksheet("Transkrip")!.rowCount).toBe(15);
    const { names } = await parts(buffer as ArrayBuffer);
    expect(names.filter((name) => name.startsWith("xl/media/"))).toHaveLength(2);
  });

  it("builds a PowerPoint deck with a slide per section", async () => {
    const data = (await buildPptx(await bundle()).write({ outputType: "nodebuffer" })) as Buffer;
    save("contoh.pptx", data);
    const { zip, names } = await parts(data);
    const slides = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    // cover, details, opening, objectives, 3 discussion, decisions, follow-ups, summary, visual, picture, attendees
    expect(slides).toHaveLength(13);
    const all = (await Promise.all(slides.map((name) => zip.file(name)!.async("string")))).join("\n");
    for (const title of ["Detail rapat", "Pembukaan", "Tujuan", "Keputusan", "Tindak lanjut", "Rangkuman", "Ringkasan visual", "Dokumentasi", "Daftar hadir"]) {
      expect(all).toContain(title);
    }
    expect(all).toContain("Jadwal peluncuran");
  });
});
