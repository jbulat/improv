// Renders GitHub's social preview card (1280x640, the link card a shared repo
// URL shows) from the repo's own art, in two layouts to choose between:
//
//   lineup  four troupe members in costume, under the title
//   device  the title on the left, the dragon on the device's screen on the right
//
//   npm run gen:social                      -> .social-preview/{lineup,device}.png
//   npm run gen:social -- --out <dir>
//
// Every pixel comes from the pieces the other previews use (sprite grids,
// layerAnchor, the device's draw order, the sim's Raster and font, and the
// device-frame.ts body), at integer scales. Everything that matters sits
// inside a 60px safe margin, since some platforms crop the card.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, parseCli, runCli } from "./lib/cli";
import {
  layerAnchor,
  loadActor,
  loadLayerArt,
  loadPalette,
  type ActorSprites,
  type LayerArt,
  type Palette,
} from "./lib/sprites";
import { Raster } from "./lib/sim-raster";
import { gfxTextWidth, CELL_H } from "./lib/gfx-font";
import { BASELINE_Y, SCREEN_H, SCREEN_W, actorScale, inkBox } from "./lib/placement";
import { FRAME_H, FRAME_W, SCREEN_SCALE, SCREEN_X, SCREEN_Y, renderDeviceBody } from "./lib/device-frame";

export const CARD_W = 1280;
export const CARD_H = 640;
export const SAFE = 60;
/** The product name on the card. One place, so a rename is one line. */
export const TITLE = "Improv";
export const TAGLINE = "A pocket-sized theatre for children's stories";

type Rgb = readonly [number, number, number];
const BG: Rgb = [0x1a, 0x1c, 0x2c]; // palette k, the colour the app clears to
const TITLE_RGB: Rgb = [0xff, 0xcd, 0x75]; // palette y, the app's title colour
const TEXT_RGB: Rgb = [0x94, 0xb0, 0xc2]; // palette s, the app's caption colour

export interface Costume {
  actor: string;
  expression: string;
  layers: [slot: string, id: string][];
  label?: string;
}

/** The troupe, dressed for the Knight story, plus the host. */
export const LINEUP: Costume[] = [
  {
    actor: "milo",
    expression: "happy_closed",
    layers: [
      ["headwear", "helmet"],
      ["front_prop", "sword"],
    ],
  },
  { actor: "rosa", expression: "happy_closed", layers: [["headwear", "tiara"]] },
  {
    actor: "tuk",
    expression: "angry_closed",
    layers: [
      ["headwear", "horns"],
      ["front_prop", "fire"],
    ],
  },
  { actor: "miss_moon", expression: "delighted_closed", layers: [] },
];
const DRAGON: Costume = { ...LINEUP[2], label: "the dragon" };

const ORDER = ["back_prop", "headwear", "front_prop"];

interface Dressed {
  actor: ActorSprites;
  expression: string[];
  layers: LayerArt[];
}

function dress(c: Costume, palette: Palette): Dressed {
  const actor = loadActor(path.join(ROOT, "sprites/actors", c.actor), palette);
  const expression = actor.expr[c.expression];
  if (!expression) throw new Error(`${c.actor} has no expression "${c.expression}"`);
  const layers = c.layers.map(([slot, id]) =>
    loadLayerArt(path.join(ROOT, "sprites/layers"), slot, id, palette),
  );
  return { actor, expression, layers };
}

/** Draw one dressed actor with its cell's top-left at (ox, oy), `s` raster
 *  pixels per base pixel, in the device's order: back props behind the body,
 *  then base, expression, headwear, front props. */
function drawDressed(ras: Raster, palette: Palette, d: Dressed, ox: number, oy: number, s: number): void {
  const grid = (g: string[], x: number, y: number, px: number) =>
    g.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        const c = palette[row[gx]];
        if (row[gx] !== "." && c) ras.fillRect(x + gx * px, y + gy * px, px, px, c.r, c.g, c.b);
      }
    });
  const layer = (slot: string) =>
    d.layers
      .filter((l) => l.slot === slot)
      .forEach((l) => {
        const a = layerAnchor(d.actor, l, s);
        grid(l.grid, ox + a.x, oy + a.y, a.px);
      });
  const { actor } = d;
  layer(ORDER[0]);
  grid(actor.base, ox, oy, s);
  const exprPx = d.expression.length === actor.face.h * 2 ? s / 2 : s;
  grid(d.expression, ox + actor.face.x * s, oy + actor.face.y * s, exprPx);
  layer(ORDER[1]);
  layer(ORDER[2]);
}

/** The largest title size, up to 10, whose width fits `width`, so a longer
 *  name shrinks instead of running into the margin or the device. */
function titleSize(width: number): number {
  return Math.max(1, Math.min(10, Math.floor(width / gfxTextWidth(TITLE, 1))));
}

function centredText(ras: Raster, s: string, cx: number, y: number, size: number, rgb: Rgb): void {
  ras.text(Math.round(cx - gfxTextWidth(s, size) / 2), y, s, size, rgb[0], rgb[1], rgb[2]);
}

/** Layout 1: title and tagline centred, four costumed actors standing on one line. */
export function renderLineup(palette: Palette): Raster {
  const ras = new Raster(CARD_W, CARD_H);
  ras.clear(...BG);
  const ts = titleSize(CARD_W - 2 * SAFE);
  centredText(ras, TITLE, CARD_W / 2, SAFE + 10, ts, TITLE_RGB);
  centredText(ras, TAGLINE, CARD_W / 2, SAFE + 10 + ts * CELL_H + 22, 3, TEXT_RGB);

  const s = 6;
  const slot = 230; // horizontal space per actor
  const baseline = CARD_H - SAFE - 10;
  const left = (CARD_W - LINEUP.length * slot) / 2;
  LINEUP.forEach((c, i) => {
    const d = dress(c, palette);
    const box = inkBox(d.actor.base);
    const cx = left + i * slot + slot / 2;
    const ox = Math.round(cx - (box.left + box.width / 2) * s);
    // The host floats; everyone else stands on the baseline.
    const oy =
      c.actor === "miss_moon" ? baseline - 170 - (box.bottom + 1) * s : baseline - (box.bottom + 1) * s;
    drawDressed(ras, palette, d, ox, oy, s);
  });
  return ras;
}

/** The dragon as the app shows it: its 135x240 screen, label at (2, 2), feet on the baseline. */
function deviceScreen(palette: Palette): Raster {
  const ras = new Raster(SCREEN_W, SCREEN_H);
  ras.clear(...BG);
  const d = dress(DRAGON, palette);
  const s = actorScale(d.actor.id);
  const box = inkBox(d.actor.base);
  const x = Math.floor((SCREEN_W - box.width * s) / 2) - box.left * s;
  const y = BASELINE_Y - box.bottom * s;
  drawDressed(ras, palette, d, x, y, s);
  ras.text(2, 2, DRAGON.label!, 1, TEXT_RGB[0], TEXT_RGB[1], TEXT_RGB[2]);
  return ras;
}

/** Layout 2: title, tagline and three small actors on the left; the dragon on
 *  the device on the right. The body is drawn at half size, so its screen is an
 *  exact 2x of the device's pixels; the body runs off the bottom edge, which is
 *  outside the safe area, while the screen stays inside it. */
export function renderDevice(palette: Palette): Raster {
  const ras = new Raster(CARD_W, CARD_H);
  ras.clear(...BG);

  // Device body at half size: a 2x2 box filter suits its smooth shapes. The
  // frame's background (its corner pixel) counts as transparent, so the
  // rounded corners blend into the card instead of showing a dark box.
  const body = renderDeviceBody();
  const empty = [body[0], body[1], body[2]];
  const bw = FRAME_W / 2;
  const bh = FRAME_H / 2;
  const bx = CARD_W - SAFE - bw;
  const by = SAFE - SCREEN_Y / 2;
  for (let y = 0; y < bh && by + y < CARD_H; y++) {
    for (let x = 0; x < bw; x++) {
      const px = [0, 0, 0];
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const o = ((2 * y + dy) * FRAME_W + 2 * x + dx) * 3;
        const isEmpty = body[o] === empty[0] && body[o + 1] === empty[1] && body[o + 2] === empty[2];
        for (let ch = 0; ch < 3; ch++) px[ch] += isEmpty ? BG[ch] : body[o + ch];
      }
      ras.pixel(bx + x, by + y, px[0] >> 2, px[1] >> 2, px[2] >> 2);
    }
  }
  // The screen, at an exact 2x (half of the frame's own SCREEN_SCALE).
  const screen = deviceScreen(palette);
  const k = SCREEN_SCALE / 2;
  const sx = bx + SCREEN_X / 2;
  const sy = by + SCREEN_Y / 2;
  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      const o = (y * SCREEN_W + x) * 3;
      ras.fillRect(sx + x * k, sy + y * k, k, k, screen.rgb[o], screen.rgb[o + 1], screen.rgb[o + 2]);
    }
  }

  const colX = SAFE + 10;
  const colW = bx - 40 - colX;
  const cx = colX + colW / 2;
  const ts = titleSize(colW);
  centredText(ras, TITLE, cx, SAFE + 30, ts, TITLE_RGB);
  const [first, ...rest] = TAGLINE.split(" for ");
  centredText(ras, first, cx, SAFE + 30 + ts * CELL_H + 26, 3, TEXT_RGB);
  centredText(
    ras,
    `for ${rest.join(" for ")}`,
    cx,
    SAFE + 30 + ts * CELL_H + 26 + 3 * CELL_H + 10,
    3,
    TEXT_RGB,
  );

  const s = 4;
  const trio = [LINEUP[0], LINEUP[1], LINEUP[3]];
  const slot = 170;
  const baseline = CARD_H - SAFE - 10;
  const left = cx - (trio.length * slot) / 2;
  trio.forEach((c, i) => {
    const d = dress(c, palette);
    const box = inkBox(d.actor.base);
    const ox = Math.round(left + i * slot + slot / 2 - (box.left + box.width / 2) * s);
    const oy =
      c.actor === "miss_moon" ? baseline - 60 - (box.bottom + 1) * s : baseline - (box.bottom + 1) * s;
    drawDressed(ras, palette, d, ox, oy, s);
  });
  return ras;
}

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run gen:social -- [--out <dir>]",
    options: { out: { type: "string" } },
  });
  const out = values.out ?? path.join(ROOT, ".social-preview");
  const palette = loadPalette(path.join(ROOT, "sprites/palette.json"));
  mkdirSync(out, { recursive: true });
  for (const [name, render] of [
    ["lineup", renderLineup],
    ["device", renderDevice],
  ] as const) {
    const file = path.join(out, `${name}.png`);
    writeFileSync(file, render(palette).toPng());
    console.log(`${file} (${CARD_W}x${CARD_H})`);
  }
}

runCli(import.meta.url, main);
