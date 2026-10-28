// The device's screen surface as a plain RGB framebuffer. Every primitive here
// mirrors one screen.* call from DEVICE-SKILL.md and clips silently at the
// edges, the way M5GFX does. Shared with tools/preview-layout.ts so the contact
// sheet and the simulator cannot drift apart.
import { encodePng } from "./png";
import { drawGfxText } from "./gfx-font";

export const SCREEN_W = 135;
export const SCREEN_H = 240;

/** QR is stubbed as an outline; a version 1 symbol is 21 modules square. */
const QR_MODULES = 21;

export type Op = (string | number)[];

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;

  constructor(width: number = SCREEN_W, height: number = SCREEN_H) {
    this.width = width;
    this.height = height;
    this.rgb = new Uint8Array(width * height * 3);
  }

  pixel(x: number, y: number, r: number, g: number, b: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 3;
    this.rgb[o] = r & 255;
    this.rgb[o + 1] = g & 255;
    this.rgb[o + 2] = b & 255;
  }

  clear(r = 0, g = 0, b = 0): void {
    for (let i = 0; i < this.width * this.height; i++) {
      this.rgb[i * 3] = r & 255;
      this.rgb[i * 3 + 1] = g & 255;
      this.rgb[i * 3 + 2] = b & 255;
    }
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    // For integer dx, round(x + dx) === round(x) + dx, so a w-wide rect covers
    // the contiguous range from round(x) of length ceil(w). Computing that
    // range directly keeps fractional rects exact and bounds the loop to the
    // framebuffer: a huge or Infinity w/h stops at the edge, and NaN gives an
    // empty range.
    const rx = Math.round(x);
    const ry = Math.round(y);
    const nx = Math.max(0, Math.ceil(w));
    const ny = Math.max(0, Math.ceil(h));
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(this.width, rx + nx);
    const y1 = Math.min(this.height, ry + ny);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.pixel(px, py, r, g, b);
    }
  }

  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    // The same pixel range as fillRect, with each edge loop bounded to the
    // visible span, so rect(0, 0, 1e9, 1e9, ...) does not step a billion times.
    const rx = Math.round(x);
    const ry = Math.round(y);
    const nx = Math.max(0, Math.ceil(w));
    const ny = Math.max(0, Math.ceil(h));
    if (!(nx > 0) || !(ny > 0)) return; // false for 0, negative, and NaN alike
    const dxStart = Math.max(0, -rx);
    const dxEnd = Math.min(nx, this.width - rx);
    for (let dx = dxStart; dx < dxEnd; dx++) {
      this.pixel(rx + dx, ry, r, g, b);
      this.pixel(rx + dx, ry + ny - 1, r, g, b);
    }
    const dyStart = Math.max(0, -ry);
    const dyEnd = Math.min(ny, this.height - ry);
    for (let dy = dyStart; dy < dyEnd; dy++) {
      this.pixel(rx, ry + dy, r, g, b);
      this.pixel(rx + nx - 1, ry + dy, r, g, b);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
    // Bresenham, endpoints inclusive.
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    // A non-finite endpoint would never satisfy the `x0 === x1 && y0 === y1`
    // exit (NaN is not equal to itself), so draw nothing.
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return;
    // Walk from the true, unclipped endpoints: Bresenham's error term depends
    // on where the walk starts, so clipping first would shift the on-screen
    // pixels of a diagonal line. pixel() discards the off-screen steps.
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    // So the step count is bounded, not the endpoints. Each axis moves
    // monotonically, so once either leaves the framebuffer in its direction of
    // travel, no later step is visible. A line that never leaves along one
    // axis, such as line(0, 0, 1e9, 0), stops at maxSteps, which is generous
    // for any line that crosses the screen.
    const maxSteps = (this.width + this.height) * 4 + 64;
    let steps = 0;
    for (;;) {
      this.pixel(x0, y0, r, g, b);
      if (x0 === x1 && y0 === y1) return;
      if (++steps > maxSteps) return;
      const xPast = (sx > 0 && x0 >= this.width) || (sx < 0 && x0 < 0);
      const yPast = (sy > 0 && y0 >= this.height) || (sy < 0 && y0 < 0);
      if (xPast || yPast) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  triangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
  ): void {
    this.line(x0, y0, x1, y1, r, g, b);
    this.line(x1, y1, x2, y2, r, g, b);
    this.line(x2, y2, x0, y0, r, g, b);
  }

  fillTriangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
  ): void {
    // Barycentric coverage over the bounding box: short, and obviously correct
    // for the degenerate cases the outline version would leave gaps in.
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1, y2)));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) {
      this.triangle(x0, y0, x1, y1, x2, y2, r, g, b);
      return;
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / area;
        const w1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) this.pixel(x, y, r, g, b);
      }
    }
  }

  text(x: number, y: number, s: string, size: number, r: number, g: number, b: number): void {
    drawGfxText((px, py) => this.pixel(px, py, r, g, b), s, x, y, Math.max(1, size));
  }

  /** A detached copy — safe to hand to a consumer that outlives the next frame. */
  snapshot(): Uint8Array {
    return this.rgb.slice();
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.rgb);
  }
}

/**
 * Apply one screen op. Returns false for anything this module does not own
 * (flip, idle, audio, buzzer, log, errors) so the caller can route it.
 */
export function applyDrawOp(ras: Raster, op: Op): boolean {
  // Missing, NaN and infinite arguments become 0, so no primitive is given a
  // non-finite coordinate.
  const n = (i: number) => {
    const v = Number(op[i]);
    return Number.isFinite(v) ? v : 0;
  };
  switch (op[0]) {
    case "clear":
      ras.clear(n(1), n(2), n(3));
      return true;
    case "pixel":
      ras.pixel(n(1), n(2), n(3), n(4), n(5));
      return true;
    case "fill_rect":
      ras.fillRect(n(1), n(2), n(3), n(4), n(5), n(6), n(7));
      return true;
    case "rect":
      ras.rect(n(1), n(2), n(3), n(4), n(5), n(6), n(7));
      return true;
    case "line":
      ras.line(n(1), n(2), n(3), n(4), n(5), n(6), n(7));
      return true;
    case "triangle":
      ras.triangle(n(1), n(2), n(3), n(4), n(5), n(6), n(7), n(8), n(9));
      return true;
    case "fill_triangle":
      ras.fillTriangle(n(1), n(2), n(3), n(4), n(5), n(6), n(7), n(8), n(9));
      return true;
    case "text":
      ras.text(n(1), n(2), String(op[3] ?? ""), n(4), n(5), n(6), n(7));
      return true;
    case "qr": {
      // No QR encoder, since no Improv app calls screen.qr. The caller logs
      // a warning.
      const scale = Math.max(1, n(4));
      const side = QR_MODULES * scale;
      ras.rect(n(1), n(2), side, side, n(5), n(6), n(7));
      return true;
    }
    case "brightness":
      // The panel dims via CSS; nothing to rasterize. Owned here so it is not
      // reported as an unknown op.
      return true;
    default:
      return false;
  }
}
