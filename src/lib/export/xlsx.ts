import ExcelJS from "exceljs";
import { APP_NAME, BRAND } from "../brand";
import { formatClock } from "../format";
import { fitBox } from "../images";
import { metaRows, namedAttendees, subtitleLine, type ExportBundle, type ExportImage } from "./common";

const argb = (value: string) => `FF${value}`;
const thin = { style: "thin" as const, color: { argb: argb(BRAND.border) } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };
const FONT = "Calibri";

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: argb(BRAND.white) }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(BRAND.blue) } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = allBorders;
  });
}

function styleBody(row: ExcelJS.Row, centerFirst = true) {
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    cell.font = { name: FONT, size: 11, color: { argb: argb(BRAND.ink) } };
    cell.alignment = { vertical: "top", horizontal: centerFirst && column === 1 ? "center" : "left", wrapText: true };
    cell.border = allBorders;
  });
}

/** A plain data sheet: one header row, frozen and filterable, then the records. */
function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: { header: string; width: number }[],
  rows: (string | number)[][],
  emptyNote: string,
) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ width: column.width }));
  styleHeader(sheet.addRow(columns.map((column) => column.header)));
  if (rows.length === 0) {
    const row = sheet.addRow([emptyNote]);
    row.getCell(1).font = { name: FONT, italic: true, color: { argb: argb(BRAND.textMuted) } };
    sheet.mergeCells(2, 1, 2, columns.length);
    return sheet;
  }
  rows.forEach((values) => styleBody(sheet.addRow(values)));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

function placeImage(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, image: ExportImage, row: number, maxWidth: number, maxHeight: number): number {
  const size = fitBox(image.width, image.height, maxWidth, maxHeight);
  const id = workbook.addImage({ base64: image.dataUrl, extension: image.type === "png" ? "png" : "jpeg" });
  sheet.addImage(id, { tl: { col: 0, row: row - 1 }, ext: { width: Math.round(size.width), height: Math.round(size.height) } });
  // Default rows are 20 px tall: step past the picture, plus one row of air.
  return row + Math.ceil(size.height / 20) + 1;
}

export function buildWorkbook(bundle: ExportBundle): ExcelJS.Workbook {
  const { meeting, images, visual, organization } = bundle;
  const minutes = meeting.minutes;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = APP_NAME;
  workbook.company = organization;
  workbook.title = `Notulen rapat: ${meeting.title}`;
  workbook.created = new Date(meeting.createdAt);
  workbook.modified = new Date(meeting.updatedAt);

  // Sheet 1: the minutes at a glance.
  const summary = workbook.addWorksheet("Ringkasan", { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 26 }, { width: 96 }];

  const title = summary.addRow([meeting.title]);
  summary.mergeCells(title.number, 1, title.number, 2);
  title.height = 34;
  title.getCell(1).font = { name: FONT, size: 20, bold: true, color: { argb: argb(BRAND.blue) } };
  title.getCell(1).alignment = { vertical: "middle" };

  const subtitle = summary.addRow([`Notulen rapat  |  ${subtitleLine(meeting)}${organization ? `  |  ${organization}` : ""}`]);
  summary.mergeCells(subtitle.number, 1, subtitle.number, 2);
  subtitle.getCell(1).font = { name: FONT, size: 11, color: { argb: argb(BRAND.textSecondary) } };
  subtitle.getCell(1).border = { bottom: { style: "medium", color: { argb: argb(BRAND.orange) } } };
  subtitle.getCell(2).border = { bottom: { style: "medium", color: { argb: argb(BRAND.orange) } } };
  summary.addRow([]);

  const pair = (label: string, value: string) => {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { name: FONT, bold: true, color: { argb: argb(BRAND.ink) } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(BRAND.blueSoft) } };
    row.getCell(2).font = { name: FONT, color: { argb: argb(BRAND.ink) } };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = allBorders;
    });
  };
  const section = (label: string) => {
    summary.addRow([]);
    const row = summary.addRow([label]);
    summary.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { name: FONT, size: 13, bold: true, color: { argb: argb(BRAND.blue) } };
  };

  metaRows(meeting).forEach(([label, value]) => pair(label, value));

  if (minutes) {
    section("Pembukaan");
    pair("Topik", minutes.topic || "-");
    pair("Pembukaan", minutes.opening || "-");
    section("Tujuan");
    if (minutes.objectives.length === 0) pair("Tujuan", "-");
    minutes.objectives.forEach((item, index) => pair(`Tujuan ${index + 1}`, item));
    section("Rangkuman");
    pair("Rangkuman", minutes.summary || "-");
    pair("Jumlah keputusan", String(minutes.decisions.length));
    pair("Jumlah tindak lanjut", String(minutes.actionItems.length));
  } else {
    section("Notulen");
    pair("Status", "Notulen belum dibuat untuk rapat ini.");
  }

  // Sheets 2 to 6: one record per row, ready to filter and sort.
  addTableSheet(
    workbook,
    "Pembahasan",
    [
      { header: "No", width: 6 },
      { header: "Topik", width: 34 },
      { header: "Ringkasan", width: 70 },
      { header: "Poin penting", width: 70 },
    ],
    (minutes?.discussion ?? []).map((item, index) => [index + 1, item.heading, item.summary, item.points.map((point) => `• ${point}`).join("\n")]),
    "Belum ada pembahasan.",
  );

  addTableSheet(
    workbook,
    "Keputusan",
    [
      { header: "No", width: 6 },
      { header: "Keputusan", width: 110 },
    ],
    (minutes?.decisions ?? []).map((item, index) => [index + 1, item]),
    "Belum ada keputusan.",
  );

  const actions = addTableSheet(
    workbook,
    "Tindak lanjut",
    [
      { header: "No", width: 6 },
      { header: "Tugas", width: 64 },
      { header: "Penanggung jawab", width: 28 },
      { header: "Tenggat", width: 22 },
      { header: "Status", width: 18 },
      { header: "Catatan", width: 36 },
    ],
    (minutes?.actionItems ?? []).map((item, index) => [index + 1, item.task, item.owner || "-", item.due || "-", "Belum mulai", ""]),
    "Belum ada tindak lanjut.",
  );
  const actionCount = minutes?.actionItems.length ?? 0;
  for (let row = 2; row < 2 + actionCount; row += 1) {
    actions.getCell(row, 5).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Belum mulai,Berjalan,Selesai,Tertunda"'],
    };
  }

  addTableSheet(
    workbook,
    "Daftar hadir",
    [
      { header: "No", width: 6 },
      { header: "Nama", width: 34 },
      { header: "Jabatan atau peran", width: 32 },
      { header: "Instansi", width: 32 },
      { header: "Kehadiran", width: 16 },
    ],
    namedAttendees(meeting).map((attendee, index) => [index + 1, attendee.name, attendee.role || "-", attendee.org || "-", attendee.present ? "Hadir" : "Tidak hadir"]),
    "Daftar hadir belum diisi.",
  );

  const transcript = workbook.addWorksheet("Transkrip", { views: [{ state: "frozen", ySplit: 1 }] });
  transcript.columns = [{ width: 12 }, { width: 26 }, { width: 120 }];
  styleHeader(transcript.addRow(["Waktu", "Pembicara", "Ucapan"]));
  meeting.segments.forEach((segment) => {
    styleBody(transcript.addRow([segment.start !== null ? formatClock(segment.start) : "", segment.speaker, segment.text]));
  });
  if (meeting.segments.length > 0) transcript.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } };

  // Sheet 7: the pictures, each with its caption.
  if (visual || images.length > 0) {
    const gallery = workbook.addWorksheet("Gambar", { views: [{ showGridLines: false }] });
    gallery.columns = [{ width: 120 }];
    let row = 1;
    const caption = (text: string, bold = false) => {
      const cell = gallery.getCell(row, 1);
      cell.value = text;
      cell.font = { name: FONT, size: bold ? 13 : 11, bold, italic: !bold, color: { argb: argb(bold ? BRAND.blue : BRAND.textSecondary) } };
      cell.alignment = { wrapText: true, vertical: "top" };
      row += 1;
    };
    if (visual) {
      caption("Ringkasan visual", true);
      row = placeImage(workbook, gallery, visual, row, 800, 450);
    }
    images.forEach((image, index) => {
      caption(`Gambar ${index + 1}. ${image.caption || image.name}`, false);
      row = placeImage(workbook, gallery, image, row, 720, 480);
    });
  }

  return workbook;
}
