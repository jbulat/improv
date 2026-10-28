// A tiny self-contained 3x5 uppercase bitmap font, just enough to caption
// preview cells (no dependency, no font file). Each glyph is 5 rows of 3
// columns; "1" is an ink pixel. Missing chars render as blank.

export const GLYPH_W = 3;
export const GLYPH_H = 5;

export const FONT: Record<string, string[]> = {
  A: ["111", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "110", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  " ": ["000", "000", "000", "000", "000"],
};

/** Pixel width of `text` at `scale`, including the 1-glyph-px inter-glyph gap. */
export function textWidth(text: string, scale: number): number {
  return (text.length * (GLYPH_W + 1) - 1) * scale;
}

/** Stamp `text` into a packed RGB buffer, clipped to the canvas. */
export function drawText(
  rgb: Uint8Array,
  canvasW: number,
  canvasH: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number],
): void {
  const fill = (fx: number, fy: number, w: number, h: number) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = fx + dx;
        const py = fy + dy;
        if (px < 0 || py < 0 || px >= canvasW || py >= canvasH) continue;
        const o = (py * canvasW + px) * 3;
        rgb[o] = color[0];
        rgb[o + 1] = color[1];
        rgb[o + 2] = color[2];
      }
    }
  };
  for (let gi = 0; gi < text.length; gi++) {
    const glyph = FONT[text[gi]] ?? FONT[" "];
    const gx = x + gi * (GLYPH_W + 1) * scale;
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (glyph[r][c] === "1") fill(gx + c * scale, y + r * scale, scale, scale);
      }
    }
  }
}
