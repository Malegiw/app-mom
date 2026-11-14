import { canvasToBlob } from "./images";

/**
 * Pictures that Claude draws for the minutes arrive as SVG text. Before one is shown or exported
 * it is cleaned of anything that could run code or load from outside, then turned into a PNG so
 * Word, Excel, and PowerPoint can all place it.
 */

export const VISUAL_WIDTH = 1600;
export const VISUAL_HEIGHT = 900;

const ALLOWED = new Set([
  "svg", "g", "defs", "marker", "title", "desc",
  "rect", "circle", "ellipse", "line", "polyline", "polygon", "path",
  "text", "tspan", "clippath", "lineargradient", "radialgradient", "stop",
]);

/** Model output sometimes wraps the document in a code fence or adds a sentence around it. */
function extractSvg(raw: string): string | null {
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  return start >= 0 && end > start ? raw.slice(start, end + "</svg>".length) : null;
}

/**
 * Returns a safe copy of the SVG, or null when the text is not a usable picture.
 * Anything outside a short list of drawing elements is removed, along with event handlers and
 * every reference that points outside the document.
 */
export function sanitizeSvg(raw: string): string | null {
  const source = extractSvg(raw);
  if (!source) return null;
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) return null;

  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (!ALLOWED.has(element.nodeName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const pointsOutside = (name === "href" || name === "xlink:href") && !value.startsWith("#");
      const loadsOutside = /url\(\s*['"]?(?!#)/i.test(value) || /^\s*(javascript|data):/i.test(value);
      if (name.startsWith("on") || pointsOutside || loadsOutside) element.removeAttribute(attribute.name);
    }
  }
  for (const attribute of Array.from(root.attributes)) {
    if (attribute.name.toLowerCase().startsWith("on")) root.removeAttribute(attribute.name);
  }
  if (root.querySelectorAll("rect, circle, ellipse, line, polyline, polygon, path, text").length === 0) return null;

  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${VISUAL_WIDTH} ${VISUAL_HEIGHT}`);
  root.setAttribute("width", String(VISUAL_WIDTH));
  root.setAttribute("height", String(VISUAL_HEIGHT));
  return new XMLSerializer().serializeToString(root);
}

/** Draws a cleaned SVG onto a white 16:9 canvas and returns it as a PNG. */
export async function rasterizeSvg(svg: string): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = VISUAL_WIDTH;
    canvas.height = VISUAL_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser ini tidak bisa menggambar.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);
    context.drawImage(image, 0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);
    return { blob: await canvasToBlob(canvas, "image/png"), width: VISUAL_WIDTH, height: VISUAL_HEIGHT };
  } finally {
    URL.revokeObjectURL(url);
  }
}
