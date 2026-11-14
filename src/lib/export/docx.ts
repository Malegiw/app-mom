import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { APP_CREDIT, APP_NAME, BRAND } from "../brand";
import { formatClock } from "../format";
import { dataUrlToBytes, fitBox } from "../images";
import { metaRows, namedAttendees, subtitleLine, type ExportBundle, type ExportImage } from "./common";

const FONT = "Calibri";
/** A4 with 2.2 cm margins leaves 9412 twips of text width. */
const PAGE_WIDTH = 11906;
const MARGIN = 1247;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
/** The same width in pixels, which is the unit pictures are sized in. */
const CONTENT_PX = Math.floor((CONTENT_WIDTH / 1440) * 96);

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BRAND.border };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function body(text: string, options: { bold?: boolean; color?: string; italics?: boolean; after?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: options.after ?? 140, line: 300 },
    children: [new TextRun({ text, bold: options.bold, italics: options.italics, color: options.color ?? BRAND.ink })],
  });
}

function h1(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}

function h2(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80, line: 290 },
    children: [new TextRun({ text, color: BRAND.ink })],
  });
}

function numbered(text: string, reference: string): Paragraph {
  return new Paragraph({
    numbering: { reference, level: 0 },
    spacing: { after: 80, line: 290 },
    children: [new TextRun({ text, color: BRAND.ink })],
  });
}

function cell(text: string, width: number, options: { header?: boolean; label?: boolean; center?: boolean } = {}): TableCell {
  const fill = options.header ? BRAND.blue : options.label ? BRAND.blueSoft : undefined;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMargins,
    verticalAlign: VerticalAlign.TOP,
    shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
    children: [
      new Paragraph({
        alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          new TextRun({
            text,
            bold: options.header || options.label,
            color: options.header ? BRAND.white : BRAND.ink,
          }),
        ],
      }),
    ],
  });
}

function table(widths: number[], header: string[] | null, rows: string[][], options: { labelColumn?: boolean; centerFirst?: boolean } = {}): Table {
  const tableRows: TableRow[] = [];
  if (header) {
    tableRows.push(new TableRow({ tableHeader: true, children: header.map((text, i) => cell(text, widths[i], { header: true, center: options.centerFirst && i === 0 })) }));
  }
  for (const row of rows) {
    tableRows.push(
      new TableRow({
        children: row.map((text, i) => cell(text, widths[i], { label: options.labelColumn && i === 0, center: options.centerFirst && i === 0 })),
      }),
    );
  }
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });
}

/** Splits the text width by proportion, with the last column absorbing rounding. */
function columns(...shares: number[]): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0);
  const widths = shares.map((share) => Math.floor((CONTENT_WIDTH * share) / total));
  widths[widths.length - 1] += CONTENT_WIDTH - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

function picture(image: ExportImage, maxHeight: number): Paragraph {
  const size = fitBox(image.width, image.height, CONTENT_PX, maxHeight);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 80 },
    keepNext: true,
    children: [
      new ImageRun({
        type: image.type,
        data: dataUrlToBytes(image.dataUrl),
        transformation: { width: Math.round(size.width), height: Math.round(size.height) },
        altText: { title: image.name, description: image.caption || image.name, name: image.name },
      }),
    ],
  });
}

const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [] });

export function buildDocx(bundle: ExportBundle): Document {
  const { meeting, images, visual, organization } = bundle;
  const minutes = meeting.minutes;
  const children: (Paragraph | Table)[] = [];

  if (organization) {
    children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: organization, color: BRAND.textSecondary, size: 22 })] }));
  }
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: meeting.title, bold: true, size: 44, color: BRAND.blue })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: BRAND.orange, space: 8 } },
      children: [new TextRun({ text: `Notulen rapat  |  ${subtitleLine(meeting)}`, color: BRAND.textSecondary, size: 22 })],
    }),
    table(columns(3, 7), null, metaRows(meeting), { labelColumn: true }),
  );

  if (minutes) {
    children.push(h1("Pembukaan"));
    if (minutes.topic) {
      children.push(
        new Paragraph({
          spacing: { after: 140, line: 300 },
          children: [new TextRun({ text: "Topik: ", bold: true, color: BRAND.ink }), new TextRun({ text: minutes.topic, color: BRAND.ink })],
        }),
      );
    }
    if (minutes.opening) children.push(body(minutes.opening));

    if (minutes.objectives.length > 0) {
      children.push(h1("Tujuan"));
      minutes.objectives.forEach((item) => children.push(bullet(item)));
    }

    if (minutes.discussion.length > 0) {
      children.push(h1("Isi pembahasan"));
      minutes.discussion.forEach((item, index) => {
        children.push(h2(`${index + 1}. ${item.heading || "Pembahasan"}`));
        if (item.summary) children.push(body(item.summary));
        item.points.forEach((point) => children.push(bullet(point)));
      });
    }

    if (minutes.decisions.length > 0) {
      children.push(h1("Keputusan"));
      minutes.decisions.forEach((item) => children.push(numbered(item, "decisions")));
    }

    if (minutes.actionItems.length > 0) {
      children.push(h1("Tindak lanjut"));
      children.push(
        table(
          columns(1, 6, 3, 2.4),
          ["No", "Tugas", "Penanggung jawab", "Tenggat"],
          minutes.actionItems.map((item, index) => [String(index + 1), item.task, item.owner || "-", item.due || "-"]),
          { centerFirst: true },
        ),
      );
    }

    if (minutes.summary) {
      children.push(h1("Rangkuman"));
      children.push(body(minutes.summary));
    }
  } else {
    children.push(spacer(), body("Notulen belum dibuat untuk rapat ini. Dokumen ini berisi detail rapat, daftar hadir, dan transkrip.", { italics: true, color: BRAND.textSecondary }));
  }

  if (visual) {
    children.push(h1("Ringkasan visual"), picture(visual, 380), spacer());
  }

  if (images.length > 0) {
    children.push(h1("Dokumentasi"));
    images.forEach((image, index) => {
      children.push(picture(image, 400));
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [
            new TextRun({ text: `Gambar ${index + 1}. `, bold: true, color: BRAND.textSecondary, size: 20 }),
            new TextRun({ text: image.caption || image.name, italics: true, color: BRAND.textSecondary, size: 20 }),
          ],
        }),
      );
    });
  }

  const attendees = namedAttendees(meeting);
  if (attendees.length > 0) {
    children.push(h1("Daftar hadir"));
    children.push(
      table(
        columns(1, 4.2, 3.4, 3.2, 2),
        ["No", "Nama", "Jabatan atau peran", "Instansi", "Kehadiran"],
        attendees.map((attendee, index) => [
          String(index + 1),
          attendee.name,
          attendee.role || "-",
          attendee.org || "-",
          attendee.present ? "Hadir" : "Tidak hadir",
        ]),
        { centerFirst: true },
      ),
    );
  }

  if (meeting.segments.length > 0) {
    children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("Lampiran: transkrip")] }));
    for (const segment of meeting.segments) {
      const lead: TextRun[] = [];
      if (segment.start !== null) lead.push(new TextRun({ text: `[${formatClock(segment.start)}]  `, color: BRAND.textMuted, size: 20 }));
      if (segment.speaker) lead.push(new TextRun({ text: `${segment.speaker}: `, bold: true, color: BRAND.blue }));
      children.push(
        new Paragraph({
          spacing: { after: 120, line: 290 },
          children: [...lead, new TextRun({ text: segment.text, color: BRAND.ink })],
        }),
      );
    }
  }

  const numberedList = (reference: string) => ({
    reference,
    levels: [
      {
        level: 0,
        format: LevelFormat.DECIMAL,
        text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 500, hanging: 320 } } },
      },
    ],
  });

  return new Document({
    creator: APP_NAME,
    title: `Notulen rapat: ${meeting.title}`,
    description: `Notulen rapat yang dibuat dengan ${APP_CREDIT}`,
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: BRAND.ink } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 30, bold: true, color: BRAND.blue },
          paragraph: { spacing: { before: 400, after: 160 }, keepNext: true },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 25, bold: true, color: BRAND.ink },
          paragraph: { spacing: { before: 240, after: 100 }, keepNext: true },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 500, hanging: 280 } }, run: { color: BRAND.orange } },
            },
          ],
        },
        numberedList("decisions"),
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_WIDTH, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${APP_CREDIT}   |   Notulen rapat: ${meeting.title}   |   Halaman `, color: BRAND.textMuted, size: 18 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: BRAND.textMuted, size: 18 }),
                  new TextRun({ text: " dari ", color: BRAND.textMuted, size: 18 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: BRAND.textMuted, size: 18 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}
