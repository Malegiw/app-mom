// Renders the app icons from one drawing. Run with: npm run icons
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "public");

/** `inset` shrinks the mark, leaving the safe area that maskable icons need. */
const icon = (rounded, inset = 0) => {
  const scale = 1 - inset * 2;
  const shift = 64 * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${rounded ? 15 : 0}" fill="#0f4c81"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">
    <rect x="17" y="18" width="30" height="5" rx="2.5" fill="#fff"/>
    <rect x="17" y="29.5" width="30" height="5" rx="2.5" fill="#fff"/>
    <rect x="17" y="41" width="15" height="5" rx="2.5" fill="#fff"/>
    <circle cx="43" cy="43.5" r="6.5" fill="#fe5000"/>
  </g>
</svg>`;
};

const render = (svg, size, file) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(path.join(out, file));

await mkdir(out, { recursive: true });
await render(icon(true), 192, "pwa-192.png");
await render(icon(true), 512, "pwa-512.png");
await render(icon(false, 0.12), 512, "pwa-maskable-512.png");
await render(icon(false, 0.04), 180, "apple-touch-icon.png");
console.log("Icons written to public/");
