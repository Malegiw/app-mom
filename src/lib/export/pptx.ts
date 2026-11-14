import PptxGenJS from "pptxgenjs";
import { APP_CREDIT, APP_NAME, BRAND } from "../brand";
import { fitBox } from "../images";
import { metaRows, namedAttendees, subtitleLine, type ExportBundle, type ExportImage } from "./common";

/** 16:9 widescreen, in inches. */
const W = 13.333;
const H = 7.5;
const LEFT = 0.85;
const CONTENT_W = W - LEFT - 0.7;
const BODY_TOP = 1.55;
const BODY_H = 5.1;
const FONT = "Calibri";
const MASTER = "NOTULA_CONTENT";

type Slide = PptxGenJS.Slide;
type TextProps = PptxGenJS.TextProps;
type TableRow = PptxGenJS.TableRow;

/** PowerPoint does not reflow text on open, so estimate lines and split long content across slides. */
function linesFor(text: string, fontSize: number, widthInches: number): number {
  const charsPerLine = Math.max(20, Math.floor((widthInches * 72) / (fontSize * 0.5)));
  return text.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

function chunkByLines(items: string[], fontSize: number, widthInches: number, maxLines: number): string[][] {
  const pages: string[][] = [];
  let page: string[] = [];
  let used = 0;
  for (const item of items) {
    const cost = linesFor(item, fontSize, widthInches) + 0.5;
    if (page.length > 0 && used + cost > maxLines) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(item);
    used += cost;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

function contentSlide(pptx: PptxGenJS, title: string): Slide {
  const slide = pptx.addSlide({ masterName: MASTER });
  slide.addText(title, {
    x: LEFT,
    y: 0.5,
    w: CONTENT_W,
    h: 0.8,
    fontFace: FONT,
    fontSize: 30,
    bold: true,
    color: BRAND.blue,
    valign: "middle",
    fit: "shrink",
  });
  return slide;
}

function bullets(items: string[], fontSize: number): TextProps[] {
  return items.map((text) => ({
    text,
    options: { bullet: { indent: 18 }, breakLine: true, fontSize, color: BRAND.ink, paraSpaceAfter: 8 },
  }));
}

function paragraph(slide: Slide, text: string, y: number, h: number, fontSize = 18) {
  slide.addText(text, { x: LEFT, y, w: CONTENT_W, h, fontFace: FONT, fontSize, color: BRAND.ink, valign: "top", lineSpacingMultiple: 1.15, fit: "shrink" });
}

function headerCell(text: string): PptxGenJS.TableCell {
  return { text, options: { bold: true, color: BRAND.white, fill: { color: BRAND.blue }, fontFace: FONT, fontSize: 13, valign: "middle" } };
}

function bodyCell(text: string, align: "left" | "center" = "left"): PptxGenJS.TableCell {
  return { text, options: { color: BRAND.ink, fontFace: FONT, fontSize: 12, valign: "top", align } };
}

function addTable(slide: Slide, rows: TableRow[], colW: number[]) {
  slide.addTable(rows, {
    x: LEFT,
    y: BODY_TOP,
    w: CONTENT_W,
    colW,
    border: { type: "solid", pt: 0.75, color: BRAND.border },
    margin: [0.06, 0.1, 0.06, 0.1],
    autoPage: false,
  });
}

function addPicture(slide: Slide, image: ExportImage, box: { x: number; y: number; w: number; h: number }) {
  const size = fitBox(image.width, image.height, box.w, box.h);
  slide.addImage({
    data: image.dataUrl.replace(/^data:/, ""),
    x: box.x + (box.w - size.width) / 2,
    y: box.y + (box.h - size.height) / 2,
    w: size.width,
    h: size.height,
    altText: image.caption || image.name,
  });
}

/** Column widths from proportions, scaled to the content width. */
function cols(...shares: number[]): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0);
  return shares.map((share) => (CONTENT_W * share) / total);
}

export function buildPptx(bundle: ExportBundle): PptxGenJS {
  const { meeting, images, visual, drawings, organization } = bundle;
  const minutes = meeting.minutes;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `Notulen rapat: ${meeting.title}`;
  pptx.subject = "Notulen rapat";
  pptx.author = meeting.notetaker || APP_NAME;
  pptx.company = organization || APP_CREDIT;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };

  pptx.defineSlideMaster({
    title: MASTER,
    background: { color: BRAND.white },
    objects: [
      { rect: { x: 0, y: 0, w: 0.3, h: H, fill: { color: BRAND.blue } } },
      { rect: { x: 0.3, y: 0, w: 0.07, h: H, fill: { color: BRAND.orange } } },
      { rect: { x: LEFT, y: 1.36, w: CONTENT_W, h: 0.02, fill: { color: BRAND.border } } },
      {
        text: {
          text: `Notulen rapat  |  ${meeting.title}`,
          options: { x: LEFT, y: H - 0.5, w: CONTENT_W - 1, h: 0.3, fontFace: FONT, fontSize: 10, color: BRAND.textMuted },
        },
      },
    ],
    slideNumber: { x: W - 1.2, y: H - 0.5, w: 0.5, h: 0.3, fontFace: FONT, fontSize: 10, color: BRAND.textMuted, align: "right" },
  });

  // Cover.
  const cover = pptx.addSlide();
  cover.background = { color: BRAND.blue };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.28, w: W, h: 0.28, fill: { color: BRAND.orange }, line: { color: BRAND.orange, width: 0 } });
  cover.addText("Notulen rapat", { x: 0.9, y: 1.5, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 20, color: "C9DCEE" });
  cover.addText(meeting.title, { x: 0.9, y: 2.05, w: W - 1.8, h: 2.1, fontFace: FONT, fontSize: 44, bold: true, color: BRAND.white, valign: "top", fit: "shrink" });
  cover.addShape(pptx.ShapeType.rect, { x: 0.9, y: 4.35, w: 1.4, h: 0.07, fill: { color: BRAND.orange }, line: { color: BRAND.orange, width: 0 } });
  cover.addText(subtitleLine(meeting), { x: 0.9, y: 4.6, w: W - 1.8, h: 0.45, fontFace: FONT, fontSize: 18, color: BRAND.white });
  const coverLines = [meeting.location, organization, meeting.organizer ? `Pemimpin rapat: ${meeting.organizer}` : ""].filter(Boolean);
  if (coverLines.length > 0) {
    cover.addText(coverLines.join("\n"), { x: 0.9, y: 5.1, w: W - 1.8, h: 1.2, fontFace: FONT, fontSize: 14, color: "C9DCEE", valign: "top" });
  }

  // Details.
  const details = contentSlide(pptx, "Detail rapat");
  addTable(
    details,
    metaRows(meeting).map(([label, value]) => [
      { text: label, options: { bold: true, color: BRAND.ink, fill: { color: BRAND.blueSoft }, fontFace: FONT, fontSize: 14 } },
      { text: value, options: { color: BRAND.ink, fontFace: FONT, fontSize: 14 } },
    ]),
    cols(3, 8),
  );

  if (minutes) {
    if (minutes.topic || minutes.opening) {
      const opening = contentSlide(pptx, "Pembukaan");
      let y = BODY_TOP;
      if (minutes.topic) {
        opening.addShape(pptx.ShapeType.rect, { x: LEFT, y, w: 0.08, h: 1.0, fill: { color: BRAND.orange }, line: { color: BRAND.orange, width: 0 } });
        opening.addText(
          [
            { text: "Topik", options: { fontSize: 13, color: BRAND.textSecondary, breakLine: true } },
            { text: minutes.topic, options: { fontSize: 22, bold: true, color: BRAND.ink } },
          ],
          { x: LEFT + 0.25, y, w: CONTENT_W - 0.25, h: 1.0, fontFace: FONT, valign: "middle", fit: "shrink" },
        );
        y += 1.3;
      }
      if (minutes.opening) paragraph(opening, minutes.opening, y, BODY_TOP + BODY_H - y, 18);
    }

    chunkByLines(minutes.objectives, 20, CONTENT_W, 11).forEach((page, index) => {
      const slide = contentSlide(pptx, index === 0 ? "Tujuan" : "Tujuan (lanjutan)");
      slide.addText(bullets(page, 20), { x: LEFT, y: BODY_TOP, w: CONTENT_W, h: BODY_H, fontFace: FONT, valign: "top" });
    });

    minutes.discussion.forEach((item, index) => {
      const title = `${index + 1}. ${item.heading || "Pembahasan"}`;
      const summaryLines = item.summary ? linesFor(item.summary, 16, CONTENT_W) : 0;
      const summaryH = item.summary ? Math.min(2.6, 0.3 + summaryLines * 0.3) : 0;
      const firstPageLines = Math.max(3, Math.floor((BODY_H - summaryH) / 0.36));
      const pages = chunkByLines(item.points, 16, CONTENT_W, firstPageLines);
      const first = contentSlide(pptx, title);
      if (item.summary) {
        first.addText(item.summary, {
          x: LEFT,
          y: BODY_TOP,
          w: CONTENT_W,
          h: summaryH,
          fontFace: FONT,
          fontSize: 16,
          color: BRAND.textSecondary,
          valign: "top",
          lineSpacingMultiple: 1.1,
          fit: "shrink",
        });
      }
      if (pages[0]) {
        first.addText(bullets(pages[0], 16), { x: LEFT, y: BODY_TOP + summaryH + 0.1, w: CONTENT_W, h: BODY_H - summaryH - 0.1, fontFace: FONT, valign: "top" });
      }
      pages.slice(1).forEach((page) => {
        const more = contentSlide(pptx, `${title} (lanjutan)`);
        more.addText(bullets(page, 16), { x: LEFT, y: BODY_TOP, w: CONTENT_W, h: BODY_H, fontFace: FONT, valign: "top" });
      });
    });

    chunkByLines(minutes.decisions, 18, CONTENT_W, 12).forEach((page, pageIndex, pages) => {
      const slide = contentSlide(pptx, pageIndex === 0 ? "Keputusan" : "Keputusan (lanjutan)");
      const offset = pages.slice(0, pageIndex).reduce((sum, p) => sum + p.length, 0);
      slide.addText(
        page.map((text, i) => ({
          text: `${offset + i + 1}.  ${text}`,
          options: { breakLine: true, fontSize: 18, color: BRAND.ink, paraSpaceAfter: 10 },
        })),
        { x: LEFT, y: BODY_TOP, w: CONTENT_W, h: BODY_H, fontFace: FONT, valign: "top" },
      );
    });

    chunk(minutes.actionItems, 7).forEach((page, pageIndex) => {
      const slide = contentSlide(pptx, pageIndex === 0 ? "Tindak lanjut" : "Tindak lanjut (lanjutan)");
      addTable(
        slide,
        [
          [headerCell("No"), headerCell("Tugas"), headerCell("Penanggung jawab"), headerCell("Tenggat")],
          ...page.map((item, i) => [bodyCell(String(pageIndex * 7 + i + 1), "center"), bodyCell(item.task), bodyCell(item.owner || "-"), bodyCell(item.due || "-")]),
        ],
        cols(0.7, 6.3, 2.6, 2),
      );
    });

    if (minutes.summary) {
      const slide = contentSlide(pptx, "Rangkuman");
      paragraph(slide, minutes.summary, BODY_TOP, BODY_H, 20);
    }
  }

  if (visual) {
    const slide = contentSlide(pptx, "Ringkasan visual");
    addPicture(slide, visual, { x: LEFT, y: BODY_TOP, w: CONTENT_W, h: BODY_H });
  }

  const captioned = (title: string, image: ExportImage, text: string) => {
    const slide = contentSlide(pptx, title);
    addPicture(slide, image, { x: LEFT, y: BODY_TOP, w: CONTENT_W, h: BODY_H - 0.6 });
    return { slide, text };
  };

  // A drawing's caption starts with its title, which becomes the slide title.
  const pictureSlides = [
    ...drawings.map((image, index) => {
      const [title, ...rest] = (image.caption || `Ilustrasi ${index + 1}`).split(". ");
      return captioned(title, image, rest.join(". ") || title);
    }),
    ...images.map((image, index) => captioned(images.length > 1 ? `Dokumentasi ${index + 1}` : "Dokumentasi", image, image.caption || image.name)),
  ];

  pictureSlides.forEach(({ slide, text }) => {
    slide.addText(text, {
      x: LEFT,
      y: BODY_TOP + BODY_H - 0.5,
      w: CONTENT_W,
      h: 0.45,
      fontFace: FONT,
      fontSize: 13,
      italic: true,
      color: BRAND.textSecondary,
      align: "center",
      fit: "shrink",
    });
  });

  chunk(namedAttendees(meeting), 10).forEach((page, pageIndex) => {
    const slide = contentSlide(pptx, pageIndex === 0 ? "Daftar hadir" : "Daftar hadir (lanjutan)");
    addTable(
      slide,
      [
        [headerCell("No"), headerCell("Nama"), headerCell("Jabatan atau peran"), headerCell("Instansi"), headerCell("Kehadiran")],
        ...page.map((attendee, i) => [
          bodyCell(String(pageIndex * 10 + i + 1), "center"),
          bodyCell(attendee.name),
          bodyCell(attendee.role || "-"),
          bodyCell(attendee.org || "-"),
          bodyCell(attendee.present ? "Hadir" : "Tidak hadir"),
        ]),
      ],
      cols(0.7, 3.6, 3, 2.8, 1.5),
    );
  });

  return pptx;
}
