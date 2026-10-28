import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { layerAnchor, loadPalette, loadActor, loadLayerArt } from "../tools/lib/sprites";
import { loadTroupe } from "../tools/lib/troupe";
import { bundleDirs, loadBundle } from "../tools/lib/bundle";
import { checkArtCoverage } from "../tools/build-app";
import { screenOverflow, describeViolation, overflowViolation, actorScale } from "../tools/lib/placement";
import { wornSlots } from "../tools/lib/layers";
import type { Performance } from "../tools/lib/types";

const LAYERS_DIR = new URL("../sprites/layers", import.meta.url).pathname;

function wornLayers(perf: Performance) {
  // Costumes and beat reveals alike — the build bakes both, so coverage checks both.
  const keys = new Set(
    [...perf.cast, ...perf.timeline].flatMap((x) => wornSlots(x.layers).map(([slot, id]) => `${slot}/${id}`)),
  );
  return [...keys].map((key) => {
    const [slot, id] = key.split("/");
    return loadLayerArt(LAYERS_DIR, slot, id, PALETTE);
  });
}

const PALETTE = loadPalette(new URL("../sprites/palette.json", import.meta.url).pathname);
const troupe = loadTroupe();

function actor(id: string) {
  return loadActor(new URL(`../sprites/actors/${id}`, import.meta.url).pathname, PALETTE);
}

// Layers that are HAIR rather than headgear, with the one head each belongs
// to. The catalog has no flag for this because it needs none anywhere else --
// improv-troupe.md's rule is the source: a fringe *is* hair, so it is
// authored in one head's hair colour and can only ever match that head. Keep
// this in step with troupe.json: art drawn in a specific actor's hair colour
// belongs here; an object that merely sits on a head does not.
const HAIR_LAYERS: [layer: string, wearer: string][] = [["fringe", "ada"]];

// The compositor clears the screen to (26, 28, 44) before it draws anything --
// which is palette `k`, the same char nearly every sprite uses for its
// outline. So "is this pixel visible" is not a property of the art alone: it
// depends on whether the pixel lands on the wearer's body or on the screen
// behind them. Derived from the palette rather than hardcoded, so a palette
// edit moves every test below with it.
const BG = Object.entries(PALETTE).find(([, c]) => c.r === 26 && c.g === 28 && c.b === 44)?.[0];
if (!BG) throw new Error("no palette entry matches the compositor's clear colour (26, 28, 44)");

interface LayerPixel {
  key: string; // "gx,gy"
  gx: number;
  gy: number;
  ch: string;
  /** True when EVERY render pixel it covers misses the wearer's ink. */
  overhangs: boolean;
  /** True when ANY render pixel it covers misses the wearer's ink. */
  partlyOff: boolean;
  /** Would a child see it: off the body, not the background; on it, not the same colour. */
  shows: boolean;
}

// One pass over a layer's ink, classified the way the screen sees it once
// anchored on a given wearer. Three tests below read the same numbers, so
// "off the body" and "visible" mean one thing in this file rather than three
// slightly different things.
function layerPixels(art: ReturnType<typeof loadLayerArt>, actorId: string): LayerPixel[] {
  const wearer = actor(actorId);
  const scale = actorScale(actorId);
  const anchor = layerAnchor(wearer, art, scale);
  const out: LayerPixel[] = [];
  art.grid.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) {
      const ch = row[gx];
      if (ch === ".") continue;
      // Render pixels are relative to the cell origin, so integer division by
      // the scale lands back on the base grid cell that covers them.
      const under = new Set<string>();
      let partlyOff = false;
      for (let dy = 0; dy < anchor.px; dy++) {
        for (let dx = 0; dx < anchor.px; dx++) {
          const rx = anchor.x + gx * anchor.px + dx;
          const ry = anchor.y + gy * anchor.px + dy;
          const b = wearer.base[Math.floor(ry / scale)]?.[Math.floor(rx / scale)];
          if (b === undefined || b === ".") partlyOff = true;
          else under.add(b);
        }
      }
      const overhangs = under.size === 0;
      out.push({
        key: `${gx},${gy}`,
        gx,
        gy,
        ch,
        overhangs,
        partlyOff,
        shows: overhangs ? ch !== BG : [...under].some((b) => b !== ch),
      });
    }
  });
  return out;
}

function exprNames(id: string): string[] {
  return Object.keys(actor(id).expr).sort();
}

function pairs(names: string[]): string[] {
  return names.flatMap((n) => [`${n}_closed`, `${n}_open`]).sort();
}

describe("art inventory", () => {
  it("every troupe actor carries the full base-6 set", () => {
    expect(troupe.actors.length).toBe(6);
    for (const a of troupe.actors) {
      expect(exprNames(a.id), a.id).toEqual(pairs(troupe.expressions.base));
    }
  });

  it("miss_moon carries her full expression set", () => {
    expect(exprNames("miss_moon")).toEqual(pairs(troupe.expressions.miss_moon));
  });

  // Overlays are interchangeable across the humans and pip (milo's 12x8).
  // Tuk's 16x10 face diverges on purpose: his head carries its own
  // double-resolution overlays and shares faces with nobody.
  it("humans and pip share milo's face dimensions; tuk diverges deliberately", () => {
    const milo = actor("milo").face;
    for (const a of troupe.actors.filter((t) => t.id !== "tuk")) {
      const f = actor(a.id).face;
      expect({ w: f.w, h: f.h }, a.id).toEqual({ w: milo.w, h: milo.h });
    }
    expect({ w: actor("tuk").face.w, h: actor("tuk").face.h }).toEqual({ w: 16, h: 10 });
  });

  // Reuses the build's own gate rather than re-implementing the rule, so the
  // test and the build cannot drift on what "covered" means.
  it("has art for every (actor, expression) pair and worn layer each bundle needs", () => {
    const bundles = bundleDirs().map(loadBundle);
    expect(bundles.length).toBeGreaterThan(0);
    for (const b of bundles) {
      const actors = [...new Set(b.perf.cast.map((c) => c.actor))].map(actor);
      expect(() => checkArtCoverage(b.perf, actors, wornLayers(b.perf)), b.name).not.toThrow();
    }
  });

  // The catalog is the director's menu: anything it offers must have art, and
  // that art must land ON SCREEN for every actor it claims to fit. The 32x32
  // cell is not the screen -- at 6x it is 192px against 135px -- so the cell
  // is not the thing to check.
  it("every catalog layer has art that lands on screen for every actor it fits", () => {
    expect(troupe.layers.length).toBeGreaterThan(0);
    for (const l of troupe.layers) {
      const art = loadLayerArt(LAYERS_DIR, l.slot, l.id, PALETTE);
      const wearers = troupe.actors.filter((a) => l.fits.includes(a.id) || l.fits.includes(a.category));
      expect(wearers.length, `${l.id} fits nobody`).toBeGreaterThan(0);
      for (const a of wearers) {
        const wearer = actor(a.id);
        // A front_prop wearer without a hand anchor would throw inside
        // layerAnchor anyway; this names the actor instead of surfacing a
        // bare exception mid-sweep.
        if (l.slot === "front_prop") {
          expect(wearer.hand, `${a.id} wears front_prop "${l.id}" but has no hand anchor`).toBeDefined();
        }
        const over = screenOverflow(a.id, wearer.base, layerAnchor(wearer, art, actorScale(a.id)), art.grid);
        const violation = overflowViolation(over, art.bleedX);
        expect(
          violation && `${l.slot} "${l.id}" on ${a.id}: ${describeViolation(violation, art.bleedX)}`,
        ).toBeNull();
      }
    }
  });

  // A hair layer is not a hat. A crown, a tiara or a pointed hat is an object
  // sitting ON the head and is *supposed* to break the wearer's outline; hair
  // is part of the head, so the moment it draws past the silhouette it stops
  // reading as hair and starts reading as headgear: a flat fringe overhanging
  // ada's rounded dome squares off the top of her head.
  //
  // Measured against the base ink at the wearer's own scale, using the same
  // anchor the compositor uses, so the rule is checked where the pixels
  // actually land rather than in cell coordinates. A pixel counts as escaping
  // if ANY part of it clears the body -- half a pixel of slab past the dome
  // is still a squared-off head.
  it("hair layers never draw outside the wearer's own silhouette", () => {
    for (const [layerId, actorId] of HAIR_LAYERS) {
      const art = loadLayerArt(LAYERS_DIR, "headwear", layerId, PALETTE);
      const escaped = layerPixels(art, actorId).filter((px) => px.partlyOff);
      expect(
        escaped.map((px) => `(${px.gx},${px.gy})`).sort(),
        `${escaped.length} pixels of "${layerId}" fall outside ${actorId}'s silhouette`,
      ).toEqual([]);
    }
  });

  // The other half of the same rule, and the one the containment test above
  // cannot see. Hair is authored in its wearer's own hair colour (see
  // improv-troupe.md's author-once-stops-at-the-hairline rule), so every
  // pixel of it that lands on hair rather than on the face is drawn in the
  // colour already underneath it and shows NOTHING. A hair layer could pass
  // "never leaves the silhouette" by disappearing into the head entirely.
  //
  // A fringe exists to hang into the face opening, and each row it slides
  // up its wearer's head hides more of it. Half is the line because a fringe
  // that shows on less than half its ink is mostly redundant with the head
  // it sits on, and `lulu-and-the-fringe-that-grew-back` builds beats 10, 13
  // and 15 on the contrast between wearing it and having it stripped: a
  // fringe nobody can see makes those three beats identical.
  it("hair layers actually show against the head they sit on", () => {
    for (const [layerId, actorId] of HAIR_LAYERS) {
      const art = loadLayerArt(LAYERS_DIR, "headwear", layerId, PALETTE);
      const px = layerPixels(art, actorId);
      const shown = px.filter((p) => p.shows).length;
      expect(
        shown / px.length,
        `"${layerId}" shows on only ${shown} of its ${px.length} pixels on ${actorId} — ` +
          `the rest are drawn in the colour already underneath them`,
      ).toBeGreaterThan(0.5);
    }
  });

  // Art that clears the wearer's silhouette is drawn against the SCREEN, and
  // the screen is cleared to palette `k` -- the same char almost every sprite
  // uses for its outline. So a layer whose overhang is `k` is invisible: it
  // draws, it passes the bounds check, and nothing appears. Black antennae
  // stalks, for example, vanish and leave their clubs floating as two dots.
  //
  // Two rules, because the first alone lets that example through:
  //
  //   1. The overhang must not be *entirely* background. A layer that draws
  //      nothing off the body at all is the degenerate case.
  //   2. Nothing may float. Every visible island of a layer has to connect
  //      back to a pixel drawn ON the wearer, or it reads as debris beside
  //      the actor rather than as something the actor is wearing. Clubs on
  //      `k` stalks satisfy rule 1 but fail this one.
  //
  // Connectivity allows one intervening invisible pixel, because a 1px `k`
  // outline against the screen is invisible BY DESIGN and separates a club's
  // core from its stalk in every sprite in this catalog. A longer invisible
  // run is a real severance, not an outline.
  //
  // A layer with no overhang at all (a fringe sits entirely inside the head)
  // is exempt -- the two hair tests above govern those.
  it("headwear that overhangs the wearer is not invisible, and never floats free of it", () => {
    for (const l of troupe.layers.filter((x) => x.slot === "headwear")) {
      const art = loadLayerArt(LAYERS_DIR, l.slot, l.id, PALETTE);
      const wearers = troupe.actors.filter((a) => l.fits.includes(a.id) || l.fits.includes(a.category));
      for (const a of wearers) {
        const px = layerPixels(art, a.id);
        const overhang = px.filter((p) => p.overhangs);
        if (overhang.length === 0) continue; // sits entirely on the head; see the hair tests

        const visible = overhang.filter((p) => p.shows).length;
        expect(
          visible,
          `"${l.id}" on ${a.id}: all ${overhang.length} overhanging pixels are the background ` +
            `colour "${BG}" — it would draw nothing`,
        ).toBeGreaterThan(0);

        const inked = new Set(px.map((p) => p.key));
        const shows = new Set(px.filter((p) => p.shows).map((p) => p.key));
        // Anchored: visible AND touching the body. Every other visible island
        // has to reach one of these to be part of the wearer.
        const anchored = new Set(px.filter((p) => p.shows && !p.overhangs).map((p) => p.key));
        const ring = (key: string) => {
          const [cx, cy] = key.split(",").map(Number);
          const out: string[] = [];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push(`${cx + dx},${cy + dy}`);
          }
          return out;
        };
        // Neighbours of a visible pixel: other visible pixels beside it, plus
        // the ones a single inked-but-invisible pixel (an outline) bridges to.
        const neighbours = (key: string) => {
          const out = new Set<string>();
          for (const n of ring(key)) {
            if (shows.has(n)) out.add(n);
            else if (inked.has(n)) for (const m of ring(n)) if (shows.has(m)) out.add(m);
          }
          out.delete(key);
          return out;
        };
        const seen = new Set<string>();
        const adrift: string[] = [];
        for (const start of shows) {
          if (seen.has(start)) continue;
          const stack = [start];
          seen.add(start);
          const island: string[] = [];
          let attached = false;
          while (stack.length) {
            const cur = stack.pop()!;
            island.push(cur);
            if (anchored.has(cur)) attached = true;
            for (const n of neighbours(cur)) {
              if (!seen.has(n)) {
                seen.add(n);
                stack.push(n);
              }
            }
          }
          if (!attached) adrift.push(`${island.length}px at (${island.sort()[0]})`);
        }
        expect(
          adrift,
          `"${l.id}" on ${a.id}: ${adrift.length} visible piece(s) reach the wearer only through ` +
            `pixels the same colour as the background — they would float free of the head`,
        ).toEqual([]);
      }
    }
  });

  // front_prop registers on a hand, and a hand cannot be derived from
  // geometry. The anchor is per-actor metadata, and the rule it encodes is not
  // "who has hands" but "who can a front_prop register on".
  //
  // For the four humans that point is the fist. Tuk carries one too, at his
  // muzzle, because `fire` leaves a dragon's mouth and needs the same
  // last-drawn slot a held item gets — the only other slot anchored on the
  // head is headwear, and the dragon is already wearing horns in it. He
  // still holds nothing: every held item's catalog `fits` is human-only, and
  // the validator enforces that, so the anchor grants a mouth prop and not a
  // sword. Pip and miss_moon carry none, and that absence is asserted rather
  // than tolerated: an anchor is what makes the slot reachable at all, so a
  // stray one would silently open it.
  const MUZZLE_ANCHORED = new Set(["tuk"]);
  it("anchors every human and the fire-breathing dragon, and nobody else", () => {
    for (const a of troupe.actors) {
      const hand = actor(a.id).hand;
      if (a.category === "human" || MUZZLE_ANCHORED.has(a.id)) {
        expect(hand, `${a.id} needs a front_prop anchor`).toBeDefined();
        expect(hand!.x, `${a.id} hand.x`).toBeGreaterThanOrEqual(0);
        expect(hand!.x, `${a.id} hand.x`).toBeLessThan(32);
        expect(hand!.y, `${a.id} hand.y`).toBeGreaterThanOrEqual(0);
        expect(hand!.y, `${a.id} hand.y`).toBeLessThan(32);
      } else {
        expect(hand, `${a.id} must not carry a front_prop anchor`).toBeUndefined();
      }
    }
    expect(actor("miss_moon").hand).toBeUndefined();
  });

  // The anchor only opens the slot; `fits` decides what may enter it. Tuk
  // having a muzzle anchor must never mean he can pick up a sword, so assert
  // the catalog keeps every held item human-only and every muzzle-anchored
  // actor's props to itself.
  it("keeps held props human-only even for the muzzle-anchored dragon", () => {
    const front = troupe.layers.filter((l) => l.slot === "front_prop");
    for (const item of front) {
      const forMuzzle = item.fits.some((f) => MUZZLE_ANCHORED.has(f));
      if (forMuzzle) {
        expect(item.fits, `"${item.id}" is a muzzle prop and must not fit humans`).not.toContain("human");
      } else {
        expect(item.fits, `"${item.id}" is a held item and must stay human-only`).toContain("human");
      }
    }
  });

  // The reverse of the check above: every committed layer grid must be claimed
  // by the catalog. An orphan .grid (renamed id, moved slot, stale file) bakes
  // into no bundle and is silently unreachable — this makes it a test failure.
  it("has no orphan layer art outside the catalog", () => {
    const cataloged = new Set(troupe.layers.map((l) => `${l.slot}/${l.id}`));
    for (const slot of readdirSync(LAYERS_DIR, { withFileTypes: true })) {
      if (!slot.isDirectory()) continue;
      const slotDir = path.join(LAYERS_DIR, slot.name);
      for (const f of readdirSync(slotDir)) {
        if (!f.endsWith(".grid")) continue;
        const id = f.slice(0, -".grid".length);
        expect(cataloged.has(`${slot.name}/${id}`), `${slot.name}/${id} has art but no catalog entry`).toBe(
          true,
        );
        // A grid without its sidecar json (or vice versa) is also a mistake.
        expect(existsSync(path.join(slotDir, `${id}.json`)), `${slot.name}/${id} missing .json sidecar`).toBe(
          true,
        );
      }
    }
  });
});
