import { listAssets } from "../db";
import { safeFileName } from "../format";
import { blobToDataUrl } from "../images";
import type { Meeting } from "../types";
import { renderVisualSummary, VISUAL_HEIGHT, VISUAL_WIDTH } from "../visual";
import { EXPORT_INFO, type ExportBundle, type ExportImage, type ExportKind } from "./common";

export { EXPORT_INFO, type ExportKind } from "./common";

/** Collects the meeting, its pictures, and the visual summary into one bundle for the file builders. */
export async function gatherBundle(meeting: Meeting, organization: string): Promise<ExportBundle> {
  const assets = await listAssets(meeting.id, "image");
  const images: ExportImage[] = [];
  const drawings: ExportImage[] = [];
  for (const asset of assets) {
    (asset.generated ? drawings : images).push({
      name: asset.name,
      caption: asset.caption,
      dataUrl: await blobToDataUrl(asset.blob),
      width: asset.width,
      height: asset.height,
      type: asset.mime === "image/png" ? "png" : "jpg",
    });
  }
  const visualBlob = await renderVisualSummary(meeting);
  const visual: ExportImage | null = visualBlob
    ? {
        name: "Ringkasan visual",
        caption: "Ringkasan visual rapat",
        dataUrl: await blobToDataUrl(visualBlob),
        width: VISUAL_WIDTH,
        height: VISUAL_HEIGHT,
        type: "png",
      }
    : null;
  return { meeting, images, visual, drawings, organization };
}

/** Builds the file. Each format's library is loaded on first use so the app itself stays light. */
export async function buildExport(kind: ExportKind, bundle: ExportBundle): Promise<Blob> {
  const { mime } = EXPORT_INFO[kind];
  if (kind === "docx") {
    const [{ buildDocx }, { Packer }] = await Promise.all([import("./docx"), import("docx")]);
    const blob = await Packer.toBlob(buildDocx(bundle));
    return new Blob([blob], { type: mime });
  }
  if (kind === "xlsx") {
    const { buildWorkbook } = await import("./xlsx");
    const buffer = await buildWorkbook(bundle).xlsx.writeBuffer();
    return new Blob([buffer], { type: mime });
  }
  const { buildPptx } = await import("./pptx");
  const data = (await buildPptx(bundle).write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Blob([data], { type: mime });
}

export function exportFileName(meeting: Meeting, kind: ExportKind): string {
  return `Notulen-${safeFileName(meeting.title)}-${meeting.date}.${EXPORT_INFO[kind].extension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari needs the URL to outlive the click by a moment.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportMeeting(kind: ExportKind, meeting: Meeting, organization: string): Promise<string> {
  const bundle = await gatherBundle(meeting, organization);
  const blob = await buildExport(kind, bundle);
  const fileName = exportFileName(meeting, kind);
  downloadBlob(blob, fileName);
  return fileName;
}
