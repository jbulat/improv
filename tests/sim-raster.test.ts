import { describe, it, expect } from "vitest";
import { Raster, applyDrawOp, SCREEN_W, SCREEN_H } from "../tools/lib/sim-raster";

/** RGB triple at (x, y). */
function at(r: Raster, x: number, y: number): [number, number, number] {
  const o = (y * r.width + x) * 3;
  return [r.rgb[o], r.rgb[o + 1], r.rgb[o + 2]];
}

/** Count of pixels that are not the given colour. */
function inkCount(r: Raster, bg: [number, number, number]): number {
  let n = 0;
  for (let i = 0; i < r.width * r.height; i++) {
    if (r.rgb[i * 3] !== bg[0] || r.rgb[i * 3 + 1] !== bg[1] || r.rgb[i * 3 + 2] !== bg[2]) n++;
  }
  return n;
}

describe("Raster", () => {
  it("defaults to the device's portrait dimensions", () => {
    const r = new Raster();
    expect(SCREEN_W).toBe(135);
    expect(SCREEN_H).toBe(240);
    expect(r.width).toBe(135);
    expect(r.height).toBe(240);
    expect(r.rgb.length).toBe(135 * 240 * 3);
  });

  it("clears every pixel to one colour", () => {
    const r = new Raster();
    r.clear(26, 28, 44);
    expect(at(r, 0, 0)).toEqual([26, 28, 44]);
    expect(at(r, 134, 239)).toEqual([26, 28, 44]);
    expect(inkCount(r, [26, 28, 44])).toBe(0);
  });

  it("fills a rect at exactly the requested extent", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    r.fillRect(10, 20, 5, 4, 255, 0, 0);
    expect(at(r, 10, 20)).toEqual([255, 0, 0]);
    expect(at(r, 14, 23)).toEqual([255, 0, 0]);
    expect(at(r, 15, 20)).toEqual([0, 0, 0]);
    expect(at(r, 10, 24)).toEqual([0, 0, 0]);
    expect(inkCount(r, [0, 0, 0])).toBe(20);
  });

  it("clips drawing that runs off any edge instead of wrapping or throwing", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    r.fillRect(-3, -3, 5, 5, 9, 9, 9);
    expect(at(r, 0, 0)).toEqual([9, 9, 9]);
    expect(at(r, 1, 1)).toEqual([9, 9, 9]);
    expect(at(r, 2, 2)).toEqual([0, 0, 0]);
    expect(inkCount(r, [0, 0, 0])).toBe(4);

    r.clear(0, 0, 0);
    r.fillRect(133, 238, 10, 10, 9, 9, 9);
    expect(inkCount(r, [0, 0, 0])).toBe(4);

    r.clear(0, 0, 0);
    r.pixel(-1, 0, 9, 9, 9);
    r.pixel(0, 999, 9, 9, 9);
    expect(inkCount(r, [0, 0, 0])).toBe(0);
  });

  it("outlines a rect without filling it", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    r.rect(0, 0, 4, 4, 1, 2, 3);
    expect(at(r, 0, 0)).toEqual([1, 2, 3]);
    expect(at(r, 3, 3)).toEqual([1, 2, 3]);
    expect(at(r, 1, 1)).toEqual([0, 0, 0]);
    expect(inkCount(r, [0, 0, 0])).toBe(12);
  });

  it("draws a horizontal line inclusive of both endpoints", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    r.line(2, 5, 6, 5, 7, 7, 7);
    expect(inkCount(r, [0, 0, 0])).toBe(5);
    expect(at(r, 2, 5)).toEqual([7, 7, 7]);
    expect(at(r, 6, 5)).toEqual([7, 7, 7]);
  });

  it("fills a triangle", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    r.fillTriangle(0, 0, 4, 0, 0, 4, 5, 5, 5);
    expect(at(r, 0, 0)).toEqual([5, 5, 5]);
    expect(at(r, 4, 4)).toEqual([0, 0, 0]);
    expect(inkCount(r, [0, 0, 0])).toBeGreaterThan(8);
  });

  it("draws text through the GFX font, in the requested colour", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    r.text(0, 0, "A", 1, 255, 205, 117);
    const n = inkCount(r, [0, 0, 0]);
    expect(n).toBeGreaterThan(4);
    r.clear(0, 0, 0);
    r.text(0, 0, "A", 2, 255, 205, 117);
    expect(inkCount(r, [0, 0, 0])).toBe(n * 4);
  });

  it("encodes a PNG of its own dimensions", () => {
    const r = new Raster();
    r.clear(1, 2, 3);
    const png = r.toPng();
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(135);
    expect(png.readUInt32BE(20)).toBe(240);
  });

  it("snapshots a detached copy", () => {
    const r = new Raster();
    r.clear(1, 1, 1);
    const snap = r.snapshot();
    r.clear(2, 2, 2);
    expect(snap[0]).toBe(1);
    expect(r.rgb[0]).toBe(2);
  });

  it("bounds fillRect to the framebuffer instead of looping on a non-finite width or height", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // Calling fillRect directly (bypassing applyDrawOp's n() guard) proves
    // the bound lives in fillRect itself, not just upstream of it.
    r.fillRect(0, 0, Infinity, 10, 9, 9, 9);
    // Returned rather than spinning forever, and clipped to the screen --
    // every pixel in the first 10 rows is painted, nothing beyond it.
    expect(at(r, 0, 0)).toEqual([9, 9, 9]);
    expect(at(r, r.width - 1, 0)).toEqual([9, 9, 9]);
    expect(inkCount(r, [0, 0, 0])).toBe(r.width * 10);

    r.clear(0, 0, 0);
    // A NaN extent must draw nothing rather than throw or hang: every
    // comparison against NaN is false, so the bounded loop's range is empty.
    r.fillRect(0, 0, 5, NaN, 9, 9, 9);
    expect(inkCount(r, [0, 0, 0])).toBe(0);
  });
});

describe("applyDrawOp", () => {
  it("applies every screen op the device exposes", () => {
    const r = new Raster();
    for (const op of [
      ["clear", 1, 2, 3],
      ["fill_rect", 0, 0, 2, 2, 9, 9, 9],
      ["rect", 5, 5, 4, 4, 9, 9, 9],
      ["line", 0, 10, 4, 10, 9, 9, 9],
      ["pixel", 20, 20, 9, 9, 9],
      ["triangle", 30, 30, 40, 30, 30, 40, 9, 9, 9],
      ["fill_triangle", 50, 50, 60, 50, 50, 60, 9, 9, 9],
      ["text", 2, 2, "HI", 1, 9, 9, 9],
      ["qr", 62, 10, "https://example.com", 4, 0, 0, 0],
      ["brightness", 128],
    ]) {
      expect(applyDrawOp(r, op as (string | number)[])).toBe(true);
    }
  });

  it("draws a placeholder box for qr rather than a real code", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    applyDrawOp(r, ["qr", 10, 10, "hello", 2, 255, 255, 255]);
    // 21 modules at scale 2 -> a 42x42 outline anchored at (10, 10).
    expect(at(r, 10, 10)).toEqual([255, 255, 255]);
    expect(at(r, 51, 51)).toEqual([255, 255, 255]);
    expect(at(r, 30, 30)).toEqual([0, 0, 0]);
  });

  it("rejects ops it does not own, so the core can route them", () => {
    const r = new Raster();
    expect(applyDrawOp(r, ["flip"])).toBe(false);
    expect(applyDrawOp(r, ["idle"])).toBe(false);
    expect(applyDrawOp(r, ["beep", 440, 100])).toBe(false);
    expect(applyDrawOp(r, ["audio.stop", 0])).toBe(false);
    expect(applyDrawOp(r, ["nonsense"])).toBe(false);
  });

  it("collapses a non-finite numeric arg to 0 and returns immediately instead of hanging", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // Whatever sim-host.lua or any other caller sends, Infinity must not
    // reach Raster.fillRect.
    expect(applyDrawOp(r, ["fill_rect", 0, 0, Infinity, Infinity, 9, 9, 9])).toBe(true);
    expect(inkCount(r, [0, 0, 0])).toBe(0);
  });
});

describe("runaway draw arguments", () => {
  it("returns rect() for a runaway extent instead of stepping once per pixel of it", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // Stepping the full extent would take a billion steps per edge. Bounded
    // to the screen, only the top edge's 135 columns at y=0 and the left
    // edge's 240 rows at x=0 are touched, sharing pixel (0,0); the bottom
    // and right edges are off-screen.
    r.rect(0, 0, 1e9, 1e9, 9, 9, 9);
    expect(at(r, 0, 0)).toEqual([9, 9, 9]);
    expect(at(r, r.width - 1, 0)).toEqual([9, 9, 9]);
    expect(at(r, 0, r.height - 1)).toEqual([9, 9, 9]);
    expect(at(r, 50, 50)).toEqual([0, 0, 0]); // interior -- the real edges never reach here
    expect(inkCount(r, [0, 0, 0])).toBe(r.width + r.height - 1);
  });

  it("returns line() for a runaway endpoint instead of stepping once per pixel of the requested line", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // Walking all the way to (1e9,1e9) would take a billion steps. Only the
    // on-screen diagonal is lit: x (width=135) runs out before y
    // (height=240), so exactly the pixels (0,0) through (134,134).
    r.line(0, 0, 1e9, 1e9, 9, 9, 9);
    expect(at(r, 0, 0)).toEqual([9, 9, 9]);
    expect(at(r, r.width - 1, r.width - 1)).toEqual([9, 9, 9]);
    expect(inkCount(r, [0, 0, 0])).toBe(r.width);
  });

  it("returns qr's rect() for a runaway scale instead of hanging", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // qr draws via rect() with side = 21 * scale, so a huge scale argument
    // is the same runaway-extent hang as the direct rect() case above,
    // reached through applyDrawOp's "qr" op instead.
    expect(applyDrawOp(r, ["qr", 0, 0, "x", 1e9, 9, 9, 9])).toBe(true);
    expect(at(r, 0, 0)).toEqual([9, 9, 9]);
    expect(inkCount(r, [0, 0, 0])).toBe(r.width + r.height - 1);
  });

  it("returns text() for a runaway size instead of iterating size * size per lit glyph pixel", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // Unbounded, size * size iterations per lit glyph bit is 1e18 for
    // size = 1e9. tests/gfx-font.test.ts pins the bound itself; this checks
    // that it reaches through Raster.text() and that real ink still comes
    // out: 'h' has ink in its first glyph column, so a 64x64 block (the
    // clamp ceiling) lands at the origin.
    r.text(0, 0, "hi", 1e9, 9, 9, 9);
    expect(at(r, 0, 0)).toEqual([9, 9, 9]);
    expect(inkCount(r, [0, 0, 0])).toBe(64 * 64);
  });

  it("rounds a fractional fillRect per pixel instead of dilating it with floor/ceil", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // (10.5, 20.5, 2, 2): per-pixel rounding draws exactly these 4; a
    // floor/ceil bound would dilate them to a 3x3 (9px) box.
    r.fillRect(10.5, 20.5, 2, 2, 9, 9, 9);
    expect(inkCount(r, [0, 0, 0])).toBe(4);
    expect(at(r, 11, 21)).toEqual([9, 9, 9]);
    expect(at(r, 11, 22)).toEqual([9, 9, 9]);
    expect(at(r, 12, 21)).toEqual([9, 9, 9]);
    expect(at(r, 12, 22)).toEqual([9, 9, 9]);
    expect(at(r, 10, 20)).toEqual([0, 0, 0]);

    r.clear(0, 0, 0);
    // (0.5, 0.5, 1, 1): exactly 1 pixel, where a floor/ceil bound would
    // draw a 2x2 (4px) box.
    r.fillRect(0.5, 0.5, 1, 1, 9, 9, 9);
    expect(inkCount(r, [0, 0, 0])).toBe(1);
    expect(at(r, 1, 1)).toEqual([9, 9, 9]);
  });
});

describe("line() with off-screen endpoints", () => {
  it("keeps Bresenham's error phase for a diagonal line with off-screen endpoints", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // Clipping (x0,y0)-(x1,y1) to the framebuffer before running Bresenham
    // moves the start point and shifts the error accumulator's phase: 26 of
    // this line's 167 on-screen pixels would land one column off in x. This
    // pixel set is what walking from the true endpoints produces, with
    // pixel() clipping each step as the device does, so a runaway-input
    // guard that clips endpoints fails here.
    r.line(-40, -20, 300, 400, 7, 7, 7);
    const expected: [number, number][] = [
      [0, 29],
      [0, 30],
      [1, 31],
      [2, 32],
      [3, 33],
      [4, 34],
      [5, 35],
      [5, 36],
      [6, 37],
      [7, 38],
      [8, 39],
      [9, 40],
      [9, 41],
      [10, 42],
      [11, 43],
      [12, 44],
      [13, 45],
      [13, 46],
      [14, 47],
      [15, 48],
      [16, 49],
      [17, 50],
      [17, 51],
      [18, 52],
      [19, 53],
      [20, 54],
      [21, 55],
      [22, 56],
      [22, 57],
      [23, 58],
      [24, 59],
      [25, 60],
      [26, 61],
      [26, 62],
      [27, 63],
      [28, 64],
      [29, 65],
      [30, 66],
      [30, 67],
      [31, 68],
      [32, 69],
      [33, 70],
      [34, 71],
      [34, 72],
      [35, 73],
      [36, 74],
      [37, 75],
      [38, 76],
      [39, 77],
      [39, 78],
      [40, 79],
      [41, 80],
      [42, 81],
      [43, 82],
      [43, 83],
      [44, 84],
      [45, 85],
      [46, 86],
      [47, 87],
      [47, 88],
      [48, 89],
      [49, 90],
      [50, 91],
      [51, 92],
      [51, 93],
      [52, 94],
      [53, 95],
      [54, 96],
      [55, 97],
      [56, 98],
      [56, 99],
      [57, 100],
      [58, 101],
      [59, 102],
      [60, 103],
      [60, 104],
      [61, 105],
      [62, 106],
      [63, 107],
      [64, 108],
      [64, 109],
      [65, 110],
      [66, 111],
      [67, 112],
      [68, 113],
      [68, 114],
      [69, 115],
      [70, 116],
      [71, 117],
      [72, 118],
      [73, 119],
      [73, 120],
      [74, 121],
      [75, 122],
      [76, 123],
      [77, 124],
      [77, 125],
      [78, 126],
      [79, 127],
      [80, 128],
      [81, 129],
      [81, 130],
      [82, 131],
      [83, 132],
      [84, 133],
      [85, 134],
      [85, 135],
      [86, 136],
      [87, 137],
      [88, 138],
      [89, 139],
      [90, 140],
      [90, 141],
      [91, 142],
      [92, 143],
      [93, 144],
      [94, 145],
      [94, 146],
      [95, 147],
      [96, 148],
      [97, 149],
      [98, 150],
      [98, 151],
      [99, 152],
      [100, 153],
      [101, 154],
      [102, 155],
      [102, 156],
      [103, 157],
      [104, 158],
      [105, 159],
      [106, 160],
      [107, 161],
      [107, 162],
      [108, 163],
      [109, 164],
      [110, 165],
      [111, 166],
      [111, 167],
      [112, 168],
      [113, 169],
      [114, 170],
      [115, 171],
      [115, 172],
      [116, 173],
      [117, 174],
      [118, 175],
      [119, 176],
      [119, 177],
      [120, 178],
      [121, 179],
      [122, 180],
      [123, 181],
      [124, 182],
      [124, 183],
      [125, 184],
      [126, 185],
      [127, 186],
      [128, 187],
      [128, 188],
      [129, 189],
      [130, 190],
      [131, 191],
      [132, 192],
      [132, 193],
      [133, 194],
      [134, 195],
    ];
    expect(inkCount(r, [0, 0, 0])).toBe(expected.length);
    for (const [x, y] of expected) expect(at(r, x, y)).toEqual([7, 7, 7]);
  });

  it("returns line() for a runaway endpoint within milliseconds while walking from the true endpoints", () => {
    const r = new Raster();
    r.clear(0, 0, 0);
    // The same runaway line as above, walked from the true (unclipped)
    // endpoints: the iteration cap alone, not endpoint clipping, keeps it
    // from stepping once per pixel of a billion-pixel line.
    const start = Date.now();
    r.line(0, 0, 1e9, 1e9, 9, 9, 9);
    expect(Date.now() - start).toBeLessThan(50);
    expect(at(r, 0, 0)).toEqual([9, 9, 9]);
    expect(at(r, r.width - 1, r.width - 1)).toEqual([9, 9, 9]);
    expect(inkCount(r, [0, 0, 0])).toBe(r.width);
  });
});
