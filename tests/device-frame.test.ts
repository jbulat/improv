import { describe, it, expect } from "vitest";
import {
  BODY,
  FRAME_H,
  FRAME_SCREEN_H,
  FRAME_SCREEN_W,
  FRAME_W,
  SCREEN_SCALE,
  SCREEN_X,
  SCREEN_Y,
  renderDeviceBody,
} from "../tools/lib/device-frame";
import { SCREEN_H, SCREEN_W } from "../tools/lib/sim-raster";

/** RGB triple at (x, y) of a FRAME_W-wide buffer. */
function at(px: Uint8Array, x: number, y: number): [number, number, number] {
  const o = (y * FRAME_W + x) * 3;
  return [px[o], px[o + 1], px[o + 2]];
}

describe("device frame geometry", () => {
  it("is exactly 9:16, which is what keeps it full-screen in a messaging app", () => {
    expect(FRAME_W * 16).toBe(FRAME_H * 9);
  });

  it("holds the screen at an integer multiple of the device's own resolution", () => {
    // Any non-integer scale reintroduces the interpolation blur the whole
    // export goes out of its way to avoid.
    expect(FRAME_SCREEN_W).toBe(SCREEN_W * SCREEN_SCALE);
    expect(FRAME_SCREEN_H).toBe(SCREEN_H * SCREEN_SCALE);
    expect(Number.isInteger(SCREEN_SCALE)).toBe(true);
  });

  it("centres the screen horizontally and fits it inside the body", () => {
    expect(SCREEN_X).toBe((FRAME_W - FRAME_SCREEN_W) / 2);
    expect(SCREEN_X).toBeGreaterThan(0);
    expect(SCREEN_Y + FRAME_SCREEN_H).toBeLessThan(FRAME_H);
  });

  it("leaves more room below the screen than above it", () => {
    // A symmetric bezel reads as a phone; the button row needs the asymmetry.
    const below = FRAME_H - SCREEN_Y - FRAME_SCREEN_H;
    expect(below).toBeGreaterThan(SCREEN_Y);
  });

  it("keeps both frame dimensions even, as H.264 4:2:0 chroma requires", () => {
    expect(FRAME_W % 2).toBe(0);
    expect(FRAME_H % 2).toBe(0);
  });
});

describe("renderDeviceBody", () => {
  const px = renderDeviceBody();

  it("returns exactly one RGB triple per frame pixel", () => {
    expect(px.length).toBe(FRAME_W * FRAME_H * 3);
  });

  it("paints the body colour in the bezel beside the screen", () => {
    // Midway up the left bezel, clear of the screen well's shadow ring.
    expect(at(px, 20, Math.round(FRAME_H / 2))).toEqual([...BODY]);
  });

  it("contrasts the body against the screen well", () => {
    // The failure this guards is a dark bezel disappearing into the app's own
    // dark background, which buys a bigger rectangle and nothing else.
    const well = at(px, SCREEN_X + 10, SCREEN_Y + 10);
    const bezel = at(px, 20, Math.round(FRAME_H / 2));
    const distance =
      Math.abs(well[0] - bezel[0]) + Math.abs(well[1] - bezel[1]) + Math.abs(well[2] - bezel[2]);
    expect(distance).toBeGreaterThan(120);
  });

  it("leaves the screen well opaque so a mis-composite is visible", () => {
    const [r, g, b] = at(px, SCREEN_X + FRAME_SCREEN_W / 2, SCREEN_Y + FRAME_SCREEN_H / 2);
    expect([r, g, b]).toEqual([0x1a, 0x1c, 0x2c]);
  });

  it("draws three buttons, not one", () => {
    // The whole reason the row exists: one centred round button below a screen
    // is the home-button idiom and reads as a phone whatever the bezel does.
    // Count runs of non-body pixels across the button row's centre line.
    const by = Math.round(SCREEN_Y + FRAME_SCREEN_H + (FRAME_H - SCREEN_Y - FRAME_SCREEN_H) / 2);
    let runs = 0;
    let inRun = false;
    for (let x = SCREEN_X + 40; x < FRAME_W - SCREEN_X - 40; x++) {
      const p = at(px, x, by);
      const isBody = p[0] === BODY[0] && p[1] === BODY[1] && p[2] === BODY[2];
      if (!isBody && !inRun) runs++;
      inRun = !isBody;
    }
    expect(runs).toBe(3);
  });

  it("accepts a different body colour", () => {
    const grey = renderDeviceBody([0x94, 0xb0, 0xc2]);
    expect(at(grey, 20, Math.round(FRAME_H / 2))).toEqual([0x94, 0xb0, 0xc2]);
  });
});
