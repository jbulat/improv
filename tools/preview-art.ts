// Render an actor's base + every expression overlay to a PNG contact sheet,
// composited the same way device-apps/improv/src/compositor.lua does, so
// sprite art can be reviewed without a device or a browser.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, UsageError, parseCli, runCli } from "./lib/cli";
import {
  layerAnchor,
  loadPalette,
  loadActor,
  loadLayerArt,
  CELL,
  type ActorSprites,
  type LayerArt,
  type Palette,
} from "./lib/sprites";
import { encodePng } from "./lib/png";
import { GLYPH_H, drawText, textWidth } from "./lib/bitmap-font";

export const SCALE = 4; // art review scale; even so 2x-resolution overlays render at SCALE/2
export const COLS = 6;
export const GUTTER = 4;
const BG: [number, number, number] = [26, 28, 44]; // the sim's clear color
const LABEL_COLOR: [number, number, number] = [210, 214, 230]; // caption text
export const LABEL_SCALE = 2; // px per font pixel
export const LABEL_H = 16; // caption band beneath each cell (>= 5 * LABEL_SCALE)

export interface Sheet {
  png: Buffer;
  rgb: Uint8Array;
  width: number;
  height: number;
  cells: string[];
}

/** The bare base, then every expression's closed/open pair, alphabetically. */
export function cellNames(actor: ActorSprites): string[] {
  const exprs = [...new Set(Object.keys(actor.expr).map((k) => k.replace(/_(closed|open)$/, "")))].sort();
  return ["base", ...exprs.flatMap((e) => [`${e}_closed`, `${e}_open`])];
}

/** The caption for a cell: its expression name (closed/open share one), upper-cased. */
export function labelFor(cellName: string): string {
  return cellName.replace(/_(closed|open)$/, "").toUpperCase();
}

export function renderSheet(actor: ActorSprites, palette: Palette, layer?: LayerArt): Sheet {
  const cells = cellNames(actor);
  const cell = CELL * SCALE;
  const rowH = cell + LABEL_H; // sprite + caption band
  const cols = Math.min(COLS, cells.length);
  const rows = Math.ceil(cells.length / COLS);
  const width = cols * cell + (cols + 1) * GUTTER;
  const height = rows * rowH + (rows + 1) * GUTTER;

  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = BG[0];
    rgb[i * 3 + 1] = BG[1];
    rgb[i * 3 + 2] = BG[2];
  }

  const block = (x: number, y: number, ch: string, px: number = SCALE) => {
    const c = palette[ch];
    if (!c) return;
    for (let dy = 0; dy < px; dy++) {
      for (let dx = 0; dx < px; dx++) {
        const px_ = x + dx;
        const py_ = y + dy;
        // Clip to the canvas: a negative x would otherwise wrap onto the
        // previous scanline's right edge (art that overhangs the cell).
        if (px_ < 0 || py_ < 0 || px_ >= width || py_ >= height) continue;
        const o = (py_ * width + px_) * 3;
        rgb[o] = c.r;
        rgb[o + 1] = c.g;
        rgb[o + 2] = c.b;
      }
    }
  };

  const drawGrid = (grid: string[], ox: number, oy: number, px: number = SCALE) => {
    grid.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== ".") block(ox + gx * px, oy + gy * px, row[gx], px);
      }
    });
  };

  // Center `text` in the caption band beneath the cell at (ox, oy).
  const drawLabel = (text: string, ox: number, oy: number) => {
    const fs = LABEL_SCALE;
    const sx = ox + Math.round((cell - textWidth(text, fs)) / 2);
    const sy = oy + cell + Math.round((LABEL_H - GLYPH_H * fs) / 2);
    drawText(rgb, width, height, text, sx, sy, fs, LABEL_COLOR);
  };

  cells.forEach((name, i) => {
    const ox = GUTTER + (i % COLS) * (cell + GUTTER);
    const oy = GUTTER + Math.floor(i / COLS) * (rowH + GUTTER);
    if (layer?.slot === "back_prop") {
      const { x: lx, y: ly, px } = layerAnchor(actor, layer, SCALE);
      drawGrid(layer.grid, ox + lx, oy + ly, px);
    }
    drawGrid(actor.base, ox, oy);
    if (name !== "base") {
      const grid = actor.expr[name];
      const px = grid.length === actor.face.h * 2 ? SCALE / 2 : SCALE;
      drawGrid(grid, ox + actor.face.x * SCALE, oy + actor.face.y * SCALE, px);
    }
    if (layer && layer.slot !== "back_prop") {
      const { x: lx, y: ly, px } = layerAnchor(actor, layer, SCALE);
      drawGrid(layer.grid, ox + lx, oy + ly, px);
    }
    drawLabel(labelFor(name), ox, oy);
  });

  return { png: encodePng(width, height, rgb), rgb, width, height, cells };
}

const USAGE =
  "usage: npm run preview:art -- <actor-id> [--layer <slot>:<id>] [--headwear <layer-id>] [--out <file.png>]";

export function main(argv: string[]): void {
  const { values, positionals } = parseCli(argv, {
    usage: USAGE,
    options: {
      layer: { type: "string" },
      headwear: { type: "string" },
      out: { type: "string" },
    },
    positionals: ["<actor-id>"],
  });
  const [id] = positionals;
  const [slot, layerId] = values.layer
    ? (values.layer.split(":") as [string, string])
    : (["headwear", values.headwear] as [string, string | undefined]);
  if (values.layer && (!slot || !layerId)) {
    throw new UsageError(`--layer takes <slot>:<id>, got "${values.layer}"`, USAGE);
  }
  const out = values.out ?? path.join(ROOT, ".art-preview", `${id}.png`);
  const palette = loadPalette(path.join(ROOT, "sprites/palette.json"));
  const layer = layerId ? loadLayerArt(path.join(ROOT, "sprites/layers"), slot, layerId, palette) : undefined;
  const sheet = renderSheet(loadActor(path.join(ROOT, "sprites/actors", id), palette), palette, layer);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, sheet.png);
  console.log(`${out} (${sheet.width}x${sheet.height})`);
  console.log(`cells: ${sheet.cells.join(", ")}`);
}

runCli(import.meta.url, main);
