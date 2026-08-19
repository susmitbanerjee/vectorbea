#!/usr/bin/env node
/**
 * Icon set generator — one SVG in, every raster a browser or OS asks for out.
 *
 * Rasterising is done by Playwright's Chromium rather than a native image
 * library. That is not a workaround, it is the point: Chromium is the renderer
 * that will actually draw this SVG in a tab, so what it produces here is what a
 * user sees. It also removes the native build dependency (`sharp`) from a repo
 * that otherwise needs none.
 *
 * The .ico is written by hand. Since Vista, an .ico may embed PNG payloads
 * directly, so the encoder below is a 6-byte header, a 16-byte directory entry
 * per size, and the PNG bytes — no BMP/AND-mask encoding, no dependency.
 *
 * Usage:  node scripts/icons/generate-icons.mjs
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const publicDir = join(repoRoot, "apps", "web", "public");
// Source of truth is app/icon.svg — Next's file convention serves it at
// /icon.svg. There must NOT also be a public/icon.svg: two files claiming one
// path is a hard "conflicting public file and page file" error in dev, and in a
// production build one silently wins.
const sourceSvg = join(repoRoot, "apps", "web", "app", "icon.svg");

/** Sizes that go into favicon.ico. 16 is the tab, 32 the bookmark bar, 48 the Windows shortcut. */
const ICO_SIZES = [16, 32, 48];

/** Standalone PNGs: [filename, size, maskable]. */
const PNG_TARGETS = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon-180.png", 180, false],
];

const svg = readFileSync(sourceSvg, "utf8");

/**
 * A maskable icon is cropped to whatever shape the launcher likes, so the mark
 * must survive the spec's safe zone: a circle of diameter 80% of the canvas.
 *
 * Two things follow, and the second is the one that is easy to get wrong.
 *
 * The ground must bleed to all four edges — a transparent or rounded-corner
 * maskable icon is the classic way to get a white border on Android, because
 * the launcher masks a shape that was already masked.
 *
 * And the mark must be scaled UP, not down. Shrinking the whole SVG to fit the
 * safe circle looks safe and is wrong: the bee occupies only the middle ~46% of
 * its own viewBox, so scaling the artwork to 60% leaves a mark covering 28% of
 * the canvas, adrift in a field of background. Instead the SVG is scaled past
 * the frame with the overflow clipped, which enlarges the ground and the bee
 * together. 1.3 is the measured ceiling: the wing tips are the furthest points
 * from centre, and at 1.4 they land ~214px out against a 205px safe radius —
 * outside, and the first thing a circular launcher mask would shave off.
 */
const MASKABLE_ZOOM = 1.3;

function pageHtml(size, maskable) {
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:#0B0D0F;overflow:hidden">
         <div style="width:100%;height:100%;transform:scale(${MASKABLE_ZOOM});transform-origin:center">${svg}</div>
       </div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;

  return `<!doctype html><meta charset="utf-8">
    <style>
      html,body{margin:0;padding:0;background:transparent}
      svg{width:100%;height:100%;display:block}
      /* The mark carries its own rounded ground. Under a launcher mask those
         corners would be rounded twice, so they are squared off here. */
      ${maskable ? "svg > rect:first-of-type{rx:0}" : ""}
    </style>
    ${inner}`;
}

async function render(page, size, maskable) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(pageHtml(size, maskable), { waitUntil: "load" });
  const target = page.locator("body > div").first();
  return target.screenshot({ omitBackground: false, type: "png" });
}

/** ICONDIR + ICONDIRENTRY[] + PNG payloads. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  // Payloads start after the header and the whole directory.
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 encodes 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size — 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

mkdirSync(publicDir, { recursive: true });

for (const [name, size, maskable] of PNG_TARGETS) {
  const data = await render(page, size, maskable);
  writeFileSync(join(publicDir, name), data);
  console.log(`  ${name.padEnd(26)} ${size}x${size}  ${data.length.toLocaleString()} bytes`);
}

const icoImages = [];
for (const size of ICO_SIZES) {
  icoImages.push({ size, data: await render(page, size, false) });
}
const ico = encodeIco(icoImages);
writeFileSync(join(publicDir, "favicon.ico"), ico);
console.log(`  favicon.ico                ${ICO_SIZES.join("/")}     ${ico.length.toLocaleString()} bytes`);

await browser.close();
console.log("\nDone. Source of truth is apps/web/app/icon.svg — re-run after changing it.");
