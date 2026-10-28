// Loads and validates sprite art: the palette, actor grids and layer grids.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { inkBox } from "./placement";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export type Palette = Record<string, Rgb>;

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ActorSprites {
  id: string;
  base: string[]; // CELL rows of CELL palette chars
  face: FaceBox;
  expr: Record<string, string[]>; // "<expression>_<closed|open>" -> face.h rows of face.w chars
  // Base-grid pixel of the grip point — where a front_prop registers. Only
  // actors with standard hands (the four humans) carry one. TS-side only:
  // actorBody() must never emit it, so it stays out of the art fingerprint
  // and a hand tweak is a story push, not a firmware reflash.
  hand?: { x: number; y: number };
}

export const CELL = 32;

export function loadPalette(file: string): Palette {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const palette: Palette = {};
  for (const [ch, hex] of Object.entries(raw)) {
    if (ch.length !== 1 || ch === ".") {
      throw new Error(`${file}: key "${ch}" must be a single char (and not ".")`);
    }
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) throw new Error(`${file}: "${ch}" has invalid color "${hex}"`);
    const v = parseInt(m[1], 16);
    palette[ch] = { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }
  if (Object.keys(palette).length > 16) throw new Error(`${file}: more than 16 colors`);
  return palette;
}

/** Validate already-split grid rows against expected dimensions and palette. */
export function checkGridRows(
  file: string,
  rows: string[],
  w: number,
  h: number,
  palette: Palette,
): string[] {
  if (rows.length !== h) throw new Error(`${file}: expected ${h} rows, got ${rows.length}`);
  rows.forEach((row, i) => {
    if (row.length !== w) throw new Error(`${file}:${i + 1}: expected ${w} chars, got ${row.length}`);
    for (const ch of row) {
      if (ch !== "." && !palette[ch]) {
        throw new Error(`${file}:${i + 1}: unknown palette char "${ch}"`);
      }
    }
  });
  return rows;
}

export function parseGrid(file: string, w: number, h: number, palette: Palette): string[] {
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  return checkGridRows(file, rows, w, h, palette);
}

export interface LayerArt {
  id: string;
  slot: string;
  grid: string[]; // h rows of w palette chars
  w: number;
  h: number;
  // Anchor offsets, in base-grid pixels, applied after the anchor determined
  // by this layer's slot (see layerAnchor for the per-slot anchor rule).
  dx: number;
  dy: number;
  // Art resolution: 1 = one grid pixel per base pixel, 2 = double-resolution
  // art drawn at half the render scale. Declared, not inferred: unlike an
  // expression overlay, a layer has no face box to compare against.
  density: number;
  // How far this layer's ink may fall off the left and right screen edges, in
  // screen pixels per side. Zero (the default) makes any overflow a build
  // error. The number records the intent, so a later, wider grid still fails.
  // Horizontal only. TS-side only: gen-sprite-data emits fields by name, so
  // this never reaches the app.
  bleedX: number;
}

/**
 * Where a layer's grid lands, and how big each of its pixels draws, in render
 * pixels relative to the wearer's cell origin (a back_prop may anchor above
 * the cell). Render pixels keep the result an integer, so rounding happens
 * once, here, not in each caller. `scale` is the render scale: actorScale(id)
 * on the device, preview-art's SCALE for a contact sheet.
 *
 * headwear registers on the face box: centred, bottom row on the row above
 * the face top. back_prop registers on the base's ink box, the one per-actor
 * frame that means the same for every body shape; it draws behind the base,
 * so a positive dy slides it down behind the body. front_prop registers on
 * the wearer's `hand` anchor: centred over it, bottom row on the hand row.
 *
 * Centring quantizes to the layer's pixel (the `* d` inside the floor), the
 * unit the art is drawn in. S.draw_character in compositor.lua mirrors this.
 */
export function layerAnchor(
  actor: { id?: string; face: FaceBox; base: string[]; hand?: { x: number; y: number } },
  art: LayerArt,
  scale: number,
): { x: number; y: number; px: number } {
  const d = art.density;
  if (scale % d !== 0) {
    throw new Error(`layer "${art.id}": scale ${scale} is not divisible by density ${d}`);
  }
  const px = scale / d;
  if (art.slot === "back_prop") {
    const ink = inkBox(actor.base);
    return {
      x: ink.left * scale + Math.floor((ink.width * d - art.w) / 2) * px + art.dx * px,
      y: ink.top * scale - art.h * px + art.dy * px,
      px,
    };
  }
  if (art.slot === "front_prop") {
    // A hand cannot be derived from geometry, so it is per-actor metadata.
    // The headwear rule with a 1-pixel box, except the bottom row lands on
    // the anchor row (the hand covers the grip).
    if (!actor.hand) {
      const who = actor.id ? ` (actor "${actor.id}")` : "";
      throw new Error(`layer "${art.id}": front_prop needs a hand anchor and this wearer${who} has none`);
    }
    return {
      x: actor.hand.x * scale + Math.floor((d - art.w) / 2) * px + art.dx * px,
      y: (actor.hand.y + 1) * scale - art.h * px + art.dy * px,
      px,
    };
  }
  const { face } = actor;
  return {
    x: face.x * scale + Math.floor((face.w * d - art.w) / 2) * px + art.dx * px,
    y: face.y * scale - art.h * px + art.dy * px,
    px,
  };
}

/** Load one layer's art: sprites/layers/<slot>/<id>.grid + <id>.json. */
export function loadLayerArt(layersDir: string, slot: string, id: string, palette: Palette): LayerArt {
  const gridFile = path.join(layersDir, slot, `${id}.grid`);
  // Split once and strip only trailing newlines, so an interior blank row is
  // kept -- and then rejected by the width check rather than silently dropped
  // (which would shrink the grid and shift the art up a pixel).
  const rows = readFileSync(gridFile, "utf8").replace(/\n+$/, "").split("\n");
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const metaFile = path.join(layersDir, slot, `${id}.json`);
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    dx?: number;
    dy?: number;
    density?: number;
    bleed_x?: number;
  };
  // Density is read before the dimension check, because it sets the cap: a
  // 2x grid covers the same screen area with twice the rows and columns.
  const density = meta.density ?? 1;
  if (density !== 1 && density !== 2) {
    throw new Error(`${metaFile}: "density" must be 1 or 2, got ${JSON.stringify(meta.density)}`);
  }
  const max = CELL * density;
  if (w < 1 || h < 1 || w > max || h > max) {
    throw new Error(`${gridFile}: grid must be between 1x1 and ${max}x${max}, got ${w}x${h}`);
  }
  const grid = checkGridRows(gridFile, rows, w, h, palette);
  for (const k of ["dx", "dy"] as const) {
    const v = meta[k];
    if (v !== undefined && !Number.isInteger(v)) {
      throw new Error(`${metaFile}: "${k}" must be an integer, got ${JSON.stringify(v)}`);
    }
  }
  const bleedX = meta.bleed_x ?? 0;
  if (!Number.isInteger(bleedX) || bleedX < 0) {
    throw new Error(
      `${metaFile}: "bleed_x" must be a non-negative integer, got ${JSON.stringify(meta.bleed_x)}`,
    );
  }
  return { id, slot, grid, w, h, dx: meta.dx ?? 0, dy: meta.dy ?? 0, density, bleedX };
}

export function loadActor(dir: string, palette: Palette): ActorSprites {
  const id = path.basename(dir);
  const metaFile = path.join(dir, "meta.json");
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    face?: Partial<FaceBox>;
    hand?: { x?: number; y?: number };
  };
  const face = meta.face;
  const { x, y, w, h } = face ?? {};
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h)
  ) {
    throw new Error(`${metaFile}: missing or invalid face box`);
  }
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > CELL || y + h > CELL) {
    throw new Error(`${metaFile}: face box out of bounds`);
  }
  let hand: { x: number; y: number } | undefined;
  if (meta.hand !== undefined) {
    const { x: hx, y: hy } = meta.hand;
    if (!Number.isInteger(hx) || !Number.isInteger(hy)) {
      throw new Error(`${metaFile}: hand anchor must have integer x and y`);
    }
    if (hx! < 0 || hy! < 0 || hx! >= CELL || hy! >= CELL) {
      throw new Error(`${metaFile}: hand anchor (${hx}, ${hy}) is outside the ${CELL}x${CELL} cell`);
    }
    hand = { x: hx!, y: hy! };
  }
  const base = parseGrid(path.join(dir, "base.grid"), CELL, CELL, palette);

  const expr: Record<string, string[]> = {};
  const exprDir = path.join(dir, "expr");
  for (const f of readdirSync(exprDir)
    .filter((f) => f.endsWith(".grid"))
    .sort()) {
    const file = path.join(exprDir, f);
    // Double-resolution overlays: exactly 2x the face box is legal and draws
    // at half the actor scale on-device; anything else is authoring error.
    const rows = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.length > 0).length;
    const mul = rows === h * 2 ? 2 : 1;
    expr[f.slice(0, -".grid".length)] = parseGrid(file, w * mul, h * mul, palette);
  }
  for (const name of Object.keys(expr)) {
    const m = /^(.+)_(closed|open)$/.exec(name);
    if (!m) throw new Error(`${exprDir}/${name}.grid: name must end in _closed or _open`);
    const twin = `${m[1]}_${m[2] === "closed" ? "open" : "closed"}`;
    if (!expr[twin]) throw new Error(`${exprDir}/${name}.grid: missing ${twin} variant`);
  }
  return { id, base, face: { x, y, w, h }, expr, hand };
}
