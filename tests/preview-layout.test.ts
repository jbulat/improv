import { describe, it, expect } from "vitest";
import { loadPalette, loadActor } from "../tools/lib/sprites";
import {
  renderLayoutSheet,
  inkBox,
  troupeOrder,
  actorScale,
  SCREEN_W,
  SCREEN_H,
  BASELINE_Y,
  GUTTER,
  LABEL_H,
} from "../tools/preview-layout";

const palette = loadPalette("sprites/palette.json");
const order = troupeOrder(["ada", "bruno", "milo", "miss_moon", "pip", "rosa", "tuk"]);
const actors = order.map((id) => loadActor(`sprites/actors/${id}`, palette));
const sheet = renderLayoutSheet(actors, palette);

const BGC = [26, 28, 44];
const at = (x: number, y: number) => {
  const o = (y * sheet.width + x) * 3;
  return [sheet.rgb[o], sheet.rgb[o + 1], sheet.rgb[o + 2]];
};
const cellX = (i: number) => GUTTER + i * (SCREEN_W + GUTTER);
const rowHasInk = (i: number, y: number) => {
  for (let x = cellX(i); x < cellX(i) + SCREEN_W; x++) {
    const [r, g, b] = at(x, GUTTER + y);
    if (r !== BGC[0] || g !== BGC[1] || b !== BGC[2]) return true;
  }
  return false;
};

describe("troupeOrder", () => {
  it("sorts the actors and forces miss_moon last", () => {
    expect(order).toEqual(["ada", "bruno", "milo", "pip", "rosa", "tuk", "miss_moon"]);
  });
});

describe("inkBox", () => {
  it("returns ink column extent and 1-based bottom", () => {
    expect(inkBox(["...", ".k.", "..."])).toEqual({ left: 1, top: 1, width: 1, bottom: 2 });
    expect(inkBox(["...", "...", "..."])).toEqual({ left: 3, top: 3, width: -3, bottom: 0 }); // degenerate: no ink
  });
});

describe("renderLayoutSheet", () => {
  it("is seven portrait screens wide plus a caption band", () => {
    expect(sheet.width).toBe(GUTTER + 7 * (SCREEN_W + GUTTER)); // 977
    expect(sheet.height).toBe(GUTTER + SCREEN_H + LABEL_H + GUTTER); // 264
    expect(sheet.png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("puts every actor's feet on the baseline: ink at row 235, none below", () => {
    for (let i = 0; i < 6; i++) {
      // pip's ink in sprites/actors/pip/base.grid closes with a full-width
      // outline row of "k", and "k" (#1a1c2c) is byte-identical
      // to BGC -- the same color this tool clears to. Grounding still uses
      // that row's ink extent (matching compositor.lua's S.init_sprites,
      // which computes bottom the same structural way), so the placement is
      // correct; the pixel is just indistinguishable from background. The
      // nearest visibly-different row is one scaled sprite-row higher.
      const inkRow = order[i] === "pip" ? BASELINE_Y - 1 - actorScale("pip") : BASELINE_Y - 1;
      expect(rowHasInk(i, inkRow), order[i]).toBe(true);
      for (let y = BASELINE_Y + 1; y < SCREEN_H; y++) {
        expect(rowHasInk(i, y), `${order[i]} row ${y}`).toBe(false);
      }
    }
  });

  it("draws the baseline guide across every cell at exactly BASELINE_Y", () => {
    for (let i = 0; i < 7; i++) {
      expect(rowHasInk(i, BASELINE_Y), order[i]).toBe(true);
    }
  });

  it("hangs miss_moon in the sky with THE END in the gap below", () => {
    const moon = 6;
    // Ink ends at MOON_Y + inkBox.bottom*actorScale("miss_moon") = 8 + 30*4 = 128
    // (last row 127). Row 127 is the closing "k" outline row of
    // sprites/actors/miss_moon/base.grid, the same background-color
    // coincidence as pip above -- check one scaled row higher, where it's
    // actually visible.
    expect(rowHasInk(moon, 127 - actorScale("miss_moon"))).toBe(true);
    for (let y = 128; y < 150; y++) {
      expect(rowHasInk(moon, y), `gap row ${y}`).toBe(false);
    }
    // THE END band: bitmap text at y=150, scale 2 -> 10 px tall.
    expect(rowHasInk(moon, 154)).toBe(true);
    expect(rowHasInk(moon, BASELINE_Y - 1)).toBe(false); // nothing near the ground
  });

  it("centers each actor's ink box within its cell", () => {
    // tuk at 6x is 132 px wide: margins 1/2. milo at 6x is 96 px: margins 19/20.
    const colHasInk = (i: number, x: number) => {
      for (let y = GUTTER; y < GUTTER + SCREEN_H - 4; y++) {
        // exclude guide row
        const [r, g, b] = at(cellX(i) + x, y);
        if (r !== BGC[0] || g !== BGC[1] || b !== BGC[2]) return true;
      }
      return false;
    };
    const tuk = order.indexOf("tuk");
    // The margin column itself is tuk's "k" outline (#1a1c2c), byte-identical
    // to BGC -- same coincidence documented for pip/miss_moon above -- so the
    // "has ink" probe checks one scaled grid-column further in, where the
    // fill color is visible (grid col 5, row 1 is horn "r"); the "no ink"
    // probes at/beyond the true margin are unaffected.
    expect(colHasInk(tuk, 1 + actorScale("tuk"))).toBe(true);
    expect(colHasInk(tuk, 0)).toBe(false);
    expect(colHasInk(tuk, 133)).toBe(false);
    const milo = order.indexOf("milo");
    expect(colHasInk(milo, 19 + actorScale("milo"))).toBe(true);
    expect(colHasInk(milo, 18)).toBe(false);
  });
});
