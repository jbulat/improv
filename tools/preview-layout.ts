// Portrait-screen placement contact sheet: one 135x240 mock per troupe
// member -- six actors grounded on the shared baseline, miss_moon in the sky
// with "THE END" beneath her -- so the layout can be reviewed without a
// device. The placement constants mirror device-apps/improv/src/
// compositor.lua (S.ACTOR_SCALE / S.BASELINE_Y / S.MOON_Y) and main.lua's
// "The End" line -- keep the two sides in sync.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, parseCli, runCli } from "./lib/cli";
import { loadPalette, loadActor, type ActorSprites, type Palette } from "./lib/sprites";
import { Raster } from "./lib/sim-raster";
import { gfxTextWidth, CELL_H } from "./lib/gfx-font";
import { SCREEN_W, SCREEN_H, BASELINE_Y, MOON_Y, actorScale, inkBox } from "./lib/placement";

export {
  SCREEN_W,
  SCREEN_H,
  BASELINE_Y,
  MOON_Y,
  ACTOR_SCALE,
  SCALE_DEFAULT,
  actorScale,
  inkBox,
} from "./lib/placement";
export const GUTTER = 4;
export const LABEL_H = 16; // caption band beneath each screen
const THE_END_Y = 150; // main.lua: screen.text(25, 150, "The End", 2)
const BG: [number, number, number] = [26, 28, 44]; // the sim's clear color
const GUIDE: [number, number, number] = [255, 205, 117]; // baseline guide
const LABEL_COLOR: [number, number, number] = [210, 214, 230];

/** Actors alphabetically, miss_moon forced last (she's the odd one out). */
export function troupeOrder(ids: string[]): string[] {
  const rest = ids.filter((id) => id !== "miss_moon").sort();
  return ids.includes("miss_moon") ? [...rest, "miss_moon"] : rest;
}

export interface LayoutSheet {
  png: Buffer;
  rgb: Uint8Array;
  width: number;
  height: number;
}

export function renderLayoutSheet(actors: ActorSprites[], palette: Palette): LayoutSheet {
  const width = GUTTER + actors.length * (SCREEN_W + GUTTER);
  const height = GUTTER + SCREEN_H + LABEL_H + GUTTER;
  // The simulator's rasterizer, so the sheet and the sim are one renderer and
  // "The End" is measured in the device's own font.
  const ras = new Raster(width, height);
  ras.clear(BG[0], BG[1], BG[2]);

  // A sprite grid at screen-local (sx, sy) inside the cell at ox.
  const drawGrid = (grid: string[], ox: number, sx: number, sy: number, scale: number) => {
    grid.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        const c = palette[row[gx]];
        if (row[gx] === "." || !c) continue;
        ras.fillRect(ox + sx + gx * scale, GUTTER + sy + gy * scale, scale, scale, c.r, c.g, c.b);
      }
    });
  };

  actors.forEach((actor, i) => {
    const ox = GUTTER + i * (SCREEN_W + GUTTER);

    // Baseline guide first; grounded feet then sit on top of it.
    ras.fillRect(ox, GUTTER + BASELINE_Y, SCREEN_W, 1, GUIDE[0], GUIDE[1], GUIDE[2]);

    const s = actorScale(actor.id);
    const box = inkBox(actor.base);
    const x = Math.floor((SCREEN_W - box.width * s) / 2) - box.left * s;
    const y = actor.id === "miss_moon" ? MOON_Y : BASELINE_Y - box.bottom * s;
    drawGrid(actor.base, ox, x, y, s);
    const overlay = actor.expr["neutral_closed"];
    if (overlay) {
      const osc = overlay.length === actor.face.h * 2 ? s / 2 : s;
      drawGrid(overlay, ox, x + actor.face.x * s, y + actor.face.y * s, osc);
    }

    if (actor.id === "miss_moon") {
      // Device content: main.lua draws "The End" at (25, 150) size 2, so the
      // sheet must use the device's font and its metrics, not a caption font.
      ras.text(ox + 25, GUTTER + THE_END_Y, "The End", 2, GUIDE[0], GUIDE[1], GUIDE[2]);
    }

    // Sheet chrome, not device content -- still the device font, so one font
    // serves the whole tool.
    const label = actor.id.replace(/_/g, " ").toUpperCase();
    const lx = Math.round((SCREEN_W - gfxTextWidth(label, 1)) / 2);
    const ly = GUTTER + SCREEN_H + Math.round((LABEL_H - CELL_H) / 2);
    ras.text(ox + lx, ly, label, 1, LABEL_COLOR[0], LABEL_COLOR[1], LABEL_COLOR[2]);
  });

  return { png: ras.toPng(), rgb: ras.rgb, width, height };
}

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run preview:layout -- [--out <file.png>]",
    options: { out: { type: "string" } },
  });
  const out = values.out ?? path.join(ROOT, ".art-preview", "layout.png");
  const palette = loadPalette(path.join(ROOT, "sprites/palette.json"));
  const ids = troupeOrder(
    readdirSync(path.join(ROOT, "sprites/actors"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );
  const actors = ids.map((id) => loadActor(path.join(ROOT, "sprites/actors", id), palette));
  const sheet = renderLayoutSheet(actors, palette);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, sheet.png);
  console.log(`${out} (${sheet.width}x${sheet.height})`);
  console.log(`actors: ${ids.join(", ")}`);
}

runCli(import.meta.url, main);
