// Metrics and plotting for the M5GFX default font (Font0). The device draws
// text via DisplayDriver::text -> setCursor/setTextSize/print with no setFont,
// so this is the font every screen.text call lands in: a 5x7 glyph in a 6x8
// cell, advancing 6*size horizontally and 8*size per line, with the cursor at
// the cell's top-left. Colour and clipping belong to the caller.
import { GFX_FONT } from "./gfx-font-data";

export const GLYPH_W = 5;
export const GLYPH_H = 8;
export const CELL_W = 6;
export const CELL_H = 8;

/**
 * Ceiling on the per-glyph scale that drawGfxText loops over. The `put` target
 * has no known size, so the loop cannot be clipped to a framebuffer. At 64 one
 * glyph cell is already 384x512 pixels; without a cap, a size of 1e9 would
 * loop size * size times per lit pixel.
 */
const MAX_GLYPH_SIZE = 64;

/** Pixel width of the widest line in `text` at `size`. */
export function gfxTextWidth(text: string, size: number): number {
  let widest = 0;
  for (const line of text.split("\n")) widest = Math.max(widest, line.length);
  return widest * CELL_W * size;
}

/** Pixel height of `text` at `size` — one CELL_H per line. */
export function gfxTextHeight(text: string, size: number): number {
  return text.split("\n").length * CELL_H * size;
}

/**
 * Plot `text` at (x, y), calling `put` once per ink pixel. Newlines return to
 * the starting x and advance one line. Characters outside the 256-glyph table
 * render blank, matching the device's ASCII-only guidance.
 */
export function drawGfxText(
  put: (x: number, y: number) => void,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  // A huge or Infinity size becomes the ceiling. NaN stays NaN, and `dy < NaN`
  // is false, so nothing is drawn.
  const boundedSize = Math.min(Math.max(size, 0), MAX_GLYPH_SIZE);
  let cx = x;
  let cy = y;
  for (const ch of text) {
    if (ch === "\n") {
      cx = x;
      cy += CELL_H * size;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code < 256) {
      const base = code * GLYPH_W;
      for (let col = 0; col < GLYPH_W; col++) {
        const bits = GFX_FONT[base + col];
        if (!bits) continue;
        for (let row = 0; row < GLYPH_H; row++) {
          if (!((bits >> row) & 1)) continue;
          for (let dy = 0; dy < boundedSize; dy++) {
            for (let dx = 0; dx < boundedSize; dx++) {
              put(cx + col * size + dx, cy + row * size + dy);
            }
          }
        }
      }
    }
    cx += CELL_W * size;
  }
}
