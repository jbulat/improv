// Draws the mock device body that a framed video export composites its screen
// into, so 135x240 pixel art on a phone reads as a small device, not a
// low-quality video. A thick bezel, a body that contrasts with the app's dark
// screen, and three buttons (one centred button reads as a phone) do that.
// Drawn in code because the repo tracks no binary images.
import { SCREEN_H, SCREEN_W } from "./sim-raster";

/** Screen size inside the frame: the device's 135x240 at an integer 4x, the
 *  same scale an unframed export uses. Never rescaled to fit the body -- the
 *  body is sized around it -- so the nearest-neighbour pixel grid stays exact. */
export const SCREEN_SCALE = 4;
export const FRAME_SCREEN_W = SCREEN_W * SCREEN_SCALE; // 540
export const FRAME_SCREEN_H = SCREEN_H * SCREEN_SCALE; // 960

/** 720x1280 is exactly 9:16, the ratio of an unframed export, so both play
 *  full-screen in Messages and WhatsApp. The check below pins the pair. */
export const FRAME_W = 720;
export const FRAME_H = 1280;

/** Screen origin within the frame. Centred horizontally; the remaining 320px
 *  of height is split unevenly, because the button row needs more room below
 *  than the speaker does above — and a symmetric bezel looks like a phone. */
export const SCREEN_X = (FRAME_W - FRAME_SCREEN_W) / 2; // 90
export const SCREEN_Y = 96;

// A frame whose screen well doesn't fit is a silent mis-composite -- the
// overlay would sit half off the body -- so it fails loudly at module load.
if (SCREEN_X < 0 || SCREEN_Y + FRAME_SCREEN_H > FRAME_H) {
  throw new Error("device-frame: the screen does not fit inside the frame");
}
if (FRAME_W * 16 !== FRAME_H * 9) {
  throw new Error(`device-frame: ${FRAME_W}x${FRAME_H} is not 9:16`);
}

export type RGB = readonly [number, number, number];

/** Sweetie-16 `o`, the palette the sprite art already uses. Warm enough to
 *  read as a child's toy rather than lab equipment, and far enough from the
 *  cast's own skin tones not to compete with them (the palette's yellow is
 *  Rosa's face, which is why the body is not yellow). */
export const BODY: RGB = [0xef, 0x7d, 0x57];

/** Sweetie-16 `k` — the colour the app itself clears to, so the screen well
 *  reads as continuous with the display when the story is on a dark beat. */
const INK: RGB = [0x1a, 0x1c, 0x2c];

const VOID: RGB = [0x0e, 0x10, 0x17];
const LED: RGB = [0xa7, 0xf0, 0x70];

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] * (1 - t) + b[0] * t),
  Math.round(a[1] * (1 - t) + b[1] * t),
  Math.round(a[2] * (1 - t) + b[2] * t),
];

/** A plain RGB canvas. Deliberately not a Raster: that one is the device's
 *  135x240 screen and carries the draw-op vocabulary the Lua app speaks. */
class Canvas {
  readonly px: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
    bg: RGB,
  ) {
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = bg[0];
      this.px[i * 3 + 1] = bg[1];
      this.px[i * 3 + 2] = bg[2];
    }
  }

  set(x: number, y: number, c: RGB, alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) {
      this.px[o + k] = Math.round(this.px[o + k] * (1 - alpha) + c[k] * alpha);
    }
  }

  /** Filled rounded rectangle. Corner test is the distance from the corner
   *  circle's centre, which is why `r` of 0 degenerates to a plain rect. */
  roundRect(x0: number, y0: number, w: number, h: number, r: number, c: RGB, alpha = 1): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const dx = Math.max(x0 + r - x, 0, x - (x0 + w - 1 - r));
        const dy = Math.max(y0 + r - y, 0, y - (y0 + h - 1 - r));
        if (dx * dx + dy * dy <= r * r) this.set(x, y, c, alpha);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c, alpha);
      }
    }
  }
}

const BUTTON_COUNT = 3;
const BUTTON_GAP = 132;
const BUTTON_R = 40;

/**
 * The device body, as FRAME_W * FRAME_H * 3 RGB bytes.
 *
 * The screen well is opaque INK: the caller composites the story over it at
 * (SCREEN_X, SCREEN_Y), so a misplaced overlay shows as a dark rectangle.
 */
export function renderDeviceBody(body: RGB = BODY): Uint8Array {
  const shadow = mix(body, INK, 0.45);
  const light = mix(body, [255, 255, 255], 0.22);
  const c = new Canvas(FRAME_W, FRAME_H, VOID);

  // Shell, then face inset by a couple of pixels: the sliver of darker shell
  // left showing along the edge is what reads as thickness rather than a flat
  // sticker.
  c.roundRect(0, 0, FRAME_W, FRAME_H, 72, shadow);
  c.roundRect(4, 2, FRAME_W - 8, FRAME_H - 10, 68, body);
  c.roundRect(4, 2, FRAME_W - 8, 26, 68, light, 0.5);

  // Recessed screen well.
  c.roundRect(SCREEN_X - 18, SCREEN_Y - 18, FRAME_SCREEN_W + 36, FRAME_SCREEN_H + 36, 14, shadow);
  c.roundRect(SCREEN_X - 6, SCREEN_Y - 6, FRAME_SCREEN_W + 12, FRAME_SCREEN_H + 12, 8, INK);

  // Speaker holes above the screen. The device has a real I2S speaker and the
  // export carries its audio, so this is the one detail that says where the
  // narration is coming from.
  for (let i = 0; i < 7; i++) c.circle(FRAME_W / 2 - 60 + i * 20, SCREEN_Y / 2, 6, shadow);

  // Button row, vertically centred in the space below the screen.
  const by = SCREEN_Y + FRAME_SCREEN_H + (FRAME_H - SCREEN_Y - FRAME_SCREEN_H) / 2;
  const first = -((BUTTON_COUNT - 1) / 2) * BUTTON_GAP;
  for (let i = 0; i < BUTTON_COUNT; i++) {
    const cx = FRAME_W / 2 + first + i * BUTTON_GAP;
    c.circle(cx, by + 4, BUTTON_R + 5, shadow); // seated shadow, offset down
    c.circle(cx, by, BUTTON_R, light);
    c.circle(cx, by, BUTTON_R - 8, mix(body, INK, 0.15));
  }

  // Side buttons, and a power LED.
  c.roundRect(FRAME_W - 8, Math.round(FRAME_H * 0.3), 10, 86, 5, shadow);
  c.roundRect(-2, Math.round(FRAME_H * 0.36), 10, 60, 5, shadow);
  c.circle(SCREEN_X + 10, by, 7, LED);

  return c.px;
}
