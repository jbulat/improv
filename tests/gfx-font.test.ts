import { describe, it, expect } from "vitest";
import { GFX_FONT, GLYPH_COUNT } from "../tools/lib/gfx-font-data";
import {
  CELL_W,
  CELL_H,
  GLYPH_W,
  GLYPH_H,
  gfxTextWidth,
  gfxTextHeight,
  drawGfxText,
} from "../tools/lib/gfx-font";

/** Ink pixels produced by drawing `text`, as "x,y" strings. */
function ink(text: string, x: number, y: number, size: number): Set<string> {
  const out = new Set<string>();
  drawGfxText((px, py) => out.add(`${px},${py}`), text, x, y, size);
  return out;
}

describe("gfx font data", () => {
  it("is 256 glyphs of 5 column bytes", () => {
    expect(GLYPH_COUNT).toBe(256);
    expect(GFX_FONT.length).toBe(256 * GLYPH_W);
  });

  it("renders space as no ink at all", () => {
    expect(ink(" ", 0, 0, 1).size).toBe(0);
  });

  it("renders a visible glyph as ink inside its 5x8 box", () => {
    const pts = ink("A", 0, 0, 1);
    expect(pts.size).toBeGreaterThan(4);
    for (const p of pts) {
      const [px, py] = p.split(",").map(Number);
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThan(GLYPH_W);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThan(CELL_H);
    }
  });
});

describe("gfx font metrics", () => {
  it("advances 6 * size per character", () => {
    expect(CELL_W).toBe(6);
    expect(gfxTextWidth("HELLO", 1)).toBe(30);
    expect(gfxTextWidth("HELLO", 2)).toBe(60);
    expect(gfxTextWidth("", 2)).toBe(0);
  });

  it("matches main.lua's centering math (half-width = len * 6 at size 2)", () => {
    // draw_title in main.lua draws a title line at x = 67 - #line * 6, so it
    // assumes the full width is len * 12 at size 2. If this breaks, titles go
    // off-centre.
    const line = "KNIGHT";
    expect(gfxTextWidth(line, 2) / 2).toBe(line.length * 6);
  });

  it("measures height by line count, 8 * size per line", () => {
    expect(gfxTextHeight("ONE", 1)).toBe(8);
    expect(gfxTextHeight("ONE", 3)).toBe(24);
    expect(gfxTextHeight("ONE\nTWO", 2)).toBe(32);
  });
});

describe("gfx font plotting", () => {
  it("scales a glyph into size x size blocks", () => {
    const one = ink("A", 0, 0, 1).size;
    const two = ink("A", 0, 0, 2).size;
    expect(two).toBe(one * 4);
  });

  it("offsets by the draw origin", () => {
    const at00 = [...ink("A", 0, 0, 1)].sort();
    const at105 = [...ink("A", 10, 5, 1)].sort();
    expect(at105).toEqual(
      at00
        .map((p) => {
          const [x, y] = p.split(",").map(Number);
          return `${x + 10},${y + 5}`;
        })
        .sort(),
    );
  });

  it("wraps to a new line on \\n, back at the origin x", () => {
    const pts = ink("A\nA", 4, 0, 1);
    const ys = [...pts].map((p) => Number(p.split(",")[1]));
    expect(Math.min(...ys)).toBeLessThan(8);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(8);
    const xs = [...pts].map((p) => Number(p.split(",")[0]));
    expect(Math.min(...xs)).toBe(
      4 + [...ink("A", 0, 0, 1)].map((p) => Number(p.split(",")[0])).sort((a, b) => a - b)[0],
    );
  });

  it("bounds the glyph-scaling loop to a fixed ceiling instead of iterating size * size per lit bit", () => {
    // Unbounded, size = 1e9 iterates size * size = 1e18 times per lit glyph
    // pixel, which is a hang in practice. Bounded, this returns at once with
    // at most GLYPH_W * GLYPH_H bits of ceiling * ceiling points each.
    const pts = ink("A", 0, 0, 1e9);
    expect(pts.size).toBeGreaterThan(0);
    expect(pts.size).toBeLessThanOrEqual(GLYPH_W * GLYPH_H * 64 * 64);
  });

  it("leaves ordinary sizes, well under the ceiling, completely unaffected", () => {
    // The ceiling only clips scale factors no on-screen text would use, so
    // ordinary sizes such as 3 still scale exactly.
    expect(ink("A", 0, 0, 3).size).toBe(ink("A", 0, 0, 1).size * 9);
  });
});
