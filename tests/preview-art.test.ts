import { describe, it, expect } from "vitest";
import { loadPalette, loadActor, layerAnchor, type ActorSprites, type LayerArt } from "../tools/lib/sprites";
import { inkBox } from "../tools/lib/placement";
import { renderSheet, cellNames, labelFor, SCALE, GUTTER, LABEL_H } from "../tools/preview-art";

const palette = loadPalette("sprites/palette.json");
const milo = loadActor("sprites/actors/milo", palette);
const rosa = loadActor("sprites/actors/rosa", palette);

describe("cellNames", () => {
  it("lists the bare base first, then each expression's closed/open pair", () => {
    const names = cellNames(milo);
    expect(names[0]).toBe("base");
    expect(names).toHaveLength(1 + Object.keys(milo.expr).length);
    expect(names.indexOf("happy_closed")).toBeLessThan(names.indexOf("happy_open"));
  });
});

describe("labelFor", () => {
  it("captions a cell with its expression name, closed/open sharing one label", () => {
    expect(labelFor("surprised_closed")).toBe("SURPRISED");
    expect(labelFor("surprised_open")).toBe("SURPRISED");
    expect(labelFor("base")).toBe("BASE");
  });
});

describe("renderSheet", () => {
  it("renders every cell for a real actor", () => {
    const sheet = renderSheet(milo, palette);
    expect(sheet.cells).toHaveLength(13); // base + 6 expressions x 2 mouths
    expect(sheet.png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(sheet.rgb).toHaveLength(sheet.width * sheet.height * 3);
  });

  it("reserves a caption band under each row and inks label pixels there", () => {
    const cell = 32 * SCALE;
    const rows = Math.ceil(cellNames(milo).length / 6);
    const sheet = renderSheet(milo, palette);
    // Height accounts for the extra LABEL_H per row (vs. a band-less sheet).
    expect(sheet.height).toBe(rows * (cell + LABEL_H) + (rows + 1) * GUTTER);
    // Some non-background pixels exist inside row 0's caption band.
    const bandTop = GUTTER + cell;
    let inked = 0;
    for (let y = bandTop; y < bandTop + LABEL_H; y++) {
      for (let x = 0; x < sheet.width; x++) {
        const o = (y * sheet.width + x) * 3;
        if (sheet.rgb[o] !== 26 || sheet.rgb[o + 1] !== 28 || sheet.rgb[o + 2] !== 44) inked++;
      }
    }
    expect(inked).toBeGreaterThan(0);
  });

  // The whole point of the preview is fidelity to the device. compositor.lua
  // draws the overlay at x + face.x * SCALE, y + face.y * SCALE -- if this
  // drifts, the preview blesses art the device renders differently.
  it("registers the overlay at the actor's face box, exactly as compositor.lua does", () => {
    const fake: ActorSprites = {
      id: "fake",
      base: Array.from({ length: 32 }, () => ".".repeat(32)),
      face: { x: 4, y: 2, w: 2, h: 1 },
      expr: { neutral_closed: ["rr"], neutral_open: ["rr"] },
    };
    const sheet = renderSheet(fake, palette);
    expect(sheet.cells).toEqual(["base", "neutral_closed", "neutral_open"]);

    const cell = 32 * SCALE;
    const ox = GUTTER + 1 * (cell + GUTTER) + fake.face.x * SCALE; // cell 1 = neutral_closed
    const oy = GUTTER + fake.face.y * SCALE;
    const at = (x: number, y: number) => {
      const o = (y * sheet.width + x) * 3;
      return [sheet.rgb[o], sheet.rgb[o + 1], sheet.rgb[o + 2]];
    };
    const red = [palette.r.r, palette.r.g, palette.r.b];

    expect(at(ox, oy)).toEqual(red); // overlay's top-left pixel
    expect(at(ox + 2 * SCALE - 1, oy + SCALE - 1)).toEqual(red); // bottom-right
    expect(at(ox - 1, oy)).not.toEqual(red); // nothing bleeds left of the face box
  });

  it("draws a 2x-resolution overlay at half SCALE, same face origin", () => {
    const fake: ActorSprites = {
      id: "fake",
      base: Array.from({ length: 32 }, () => ".".repeat(32)),
      face: { x: 4, y: 2, w: 2, h: 1 },
      expr: { neutral_closed: ["rrrr", "rrrr"], neutral_open: ["rrrr", "rrrr"] },
    };
    const sheet = renderSheet(fake, palette);
    const half = SCALE / 2;
    const ox = GUTTER + 1 * (32 * SCALE + GUTTER) + fake.face.x * SCALE;
    const oy = GUTTER + fake.face.y * SCALE;
    const at = (x: number, y: number) => {
      const o = (y * sheet.width + x) * 3;
      return [sheet.rgb[o], sheet.rgb[o + 1], sheet.rgb[o + 2]];
    };
    const red = [palette.r.r, palette.r.g, palette.r.b];
    expect(at(ox, oy)).toEqual(red); // same origin
    expect(at(ox + 4 * half - 1, oy + 2 * half - 1)).toEqual(red); // spans w*2 half-pixels
    expect(at(ox + 4 * half, oy)).not.toEqual(red); // not double-size
  });

  // A headwear can anchor off the left of the cell (misfit art, or --headwear
  // on the wrong actor). block() must clip such pixels, not let a negative
  // image-x wrap onto the previous scanline's right edge.
  it("clips a headwear that overhangs the cell instead of wrapping it", () => {
    const fake: ActorSprites = {
      id: "fake",
      base: Array.from({ length: 32 }, () => ".".repeat(32)),
      face: { x: 0, y: 5, w: 2, h: 1 },
      expr: { neutral_closed: ["."], neutral_open: ["."] },
    };
    // dx=-2 puts the top-left column a full cell (SCALE px) left of the cell
    // origin; a wrap would ink the sheet's far-right margin column.
    const overhang: LayerArt = {
      id: "x",
      slot: "headwear",
      grid: ["rr"],
      w: 2,
      h: 1,
      dx: -2,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    const sheet = renderSheet(fake, palette, overhang);
    const red = [palette.r.r, palette.r.g, palette.r.b];
    let wrapped = 0;
    for (let y = 0; y < sheet.height; y++) {
      const o = (y * sheet.width + (sheet.width - 1)) * 3;
      if (sheet.rgb[o] === red[0] && sheet.rgb[o + 1] === red[1] && sheet.rgb[o + 2] === red[2]) wrapped++;
    }
    expect(wrapped).toBe(0);
  });

  it("leaves transparent grid cells as background", () => {
    const fake: ActorSprites = {
      id: "fake",
      base: Array.from({ length: 32 }, () => ".".repeat(32)),
      face: { x: 0, y: 0, w: 1, h: 1 },
      expr: { neutral_closed: ["."], neutral_open: ["."] },
    };
    const sheet = renderSheet(fake, palette);
    const at = (x: number, y: number) => {
      const o = (y * sheet.width + x) * 3;
      return [sheet.rgb[o], sheet.rgb[o + 1], sheet.rgb[o + 2]];
    };
    expect(at(GUTTER, GUTTER)).toEqual([26, 28, 44]);
  });

  it("draws a back_prop behind the base in the contact sheet", () => {
    const wing: LayerArt = {
      id: "w",
      slot: "back_prop",
      grid: ["rrrr"],
      w: 4,
      h: 1,
      dx: 0,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    const sheet = renderSheet(rosa, palette, wing);
    const bare = renderSheet(rosa, palette);
    // The prop sits above rosa's ink, so the sheet must differ from bare.
    expect(Buffer.compare(Buffer.from(sheet.rgb), Buffer.from(bare.rgb))).not.toBe(0);
  });

  // The Buffer.compare check above passes as soon as ANY pixel changes -- it
  // would pass even if a back_prop drew at the wrong anchor (e.g. the
  // face box) or drew in front of the base instead of behind it. Pin both:
  // a wing that overlaps rosa's ink (positive dy, per layerAnchor's doc
  // comment) must vanish under the base at the overlap, while still showing
  // above it -- that is what "behind" means, and it is the only fixture that
  // can tell "behind" apart from "in front" instead of just "somewhere else".
  it("registers a back_prop on the ink box and lets the base occlude it, not the reverse", () => {
    const wing: LayerArt = {
      id: "w",
      slot: "back_prop",
      grid: ["rrrr", "rrrr"],
      w: 4,
      h: 2,
      dx: 0,
      dy: 1,
      density: 1,
      bleedX: 0,
    };
    const ink = inkBox(rosa.base);
    const anchor = layerAnchor(rosa, wing, SCALE);
    // Sanity on the fixture itself: row `anchor.y` must fall strictly above
    // rosa's ink, and the row below it must land exactly on the topmost inked
    // base row -- otherwise this test isn't exercising an overlap at all and
    // the assertions below would be vacuous. In sheet pixels, so ink.top
    // is multiplied through and one grid row is anchor.px.
    expect(anchor.y).toBeLessThan(ink.top * SCALE);
    expect(anchor.y + anchor.px).toBe(ink.top * SCALE);

    const ox = GUTTER; // "base" is cell 0
    const oy = GUTTER;

    const bare = renderSheet(rosa, palette);
    const sheet = renderSheet(rosa, palette, wing);
    const at = (rgb: Uint8Array, width: number, x: number, y: number) => {
      const o = ((oy + y) * width + (ox + x)) * 3;
      return [rgb[o], rgb[o + 1], rgb[o + 2]];
    };
    const red = [palette.r.r, palette.r.g, palette.r.b];

    // Above rosa's ink: nothing to occlude the prop, so it paints through on
    // both the wrong-order and the right-order implementation alike -- this
    // alone would not distinguish them, hence the next check.
    expect(at(sheet.rgb, sheet.width, anchor.x + 1, anchor.y)).toEqual(red);
    expect(at(bare.rgb, bare.width, anchor.x + 1, anchor.y)).not.toEqual(red); // bare has no wing at all

    // At the overlap row (rosa's topmost inked row): drawn behind, the base's
    // own ink paints over the prop here, so this pixel must be untouched by
    // the wing -- identical to the bare actor. Drawn in front by mistake,
    // this pixel would show the wing's red instead. One grid row down is
    // anchor.px sheet pixels, not literally 1.
    expect(at(sheet.rgb, sheet.width, anchor.x + anchor.px, anchor.y + anchor.px)).not.toEqual(red);
    expect(at(sheet.rgb, sheet.width, anchor.x + anchor.px, anchor.y + anchor.px)).toEqual(
      at(bare.rgb, bare.width, anchor.x + anchor.px, anchor.y + anchor.px),
    );
  });
});
