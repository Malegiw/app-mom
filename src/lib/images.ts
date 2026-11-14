/** Picture helpers: every picture is stored as a JPEG so Word, Excel, and PowerPoint can all embed it. */

export interface NormalizedImage {
  blob: Blob;
  width: number;
  height: number;
}

async function decode(source: Blob): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path, which handles formats createImageBitmap refuses.
    }
  }
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Gambar ini tidak bisa dibuka di browser ini. Coba simpan sebagai JPG atau PNG lebih dulu.");
  }
}

/** Re-encodes any picture as JPEG, scaled so its longest side is at most `maxSide` pixels. */
export async function normalizeImage(source: Blob, maxSide = 2000, quality = 0.88): Promise<NormalizedImage> {
  const decoded = await decode(source);
  try {
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Browser ini tidak bisa memproses gambar.");
    // JPEG has no transparency: paint white first so see-through PNGs do not turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    decoded.draw(ctx, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    return { blob, width, height };
  } finally {
    decoded.close();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Gambar gagal dibuat."))), type, quality);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Berkas gagal dibaca."));
    reader.readAsDataURL(blob);
  });
}

/** "data:image/jpeg;base64,AAAA" -> "AAAA". */
export const dataUrlToBase64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrlToBase64(dataUrl));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Scales a box to fit inside a maximum box while keeping its proportions. */
export function fitBox(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}
