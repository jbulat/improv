import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  emitSpritesLua,
  emitLayerArtLua,
  emitPaletteChunk,
  emitActorChunk,
  troupeArtFingerprint,
} from "../tools/gen-sprite-data";
import { loadPalette, loadActor, loadLayerArt, type Palette } from "../tools/lib/sprites";

const PALETTE = loadPalette(new URL("../sprites/palette.json", import.meta.url).pathname);
const TUK = loadActor(new URL("../sprites/actors/tuk", import.meta.url).pathname, PALETTE);

// Pulls the key names out of the emitted `S.palette = { ... }` block, in emission order.
function extractPaletteKeys(lua: string): string[] {
  const block = /S\.palette = \{\n([\s\S]*?)\n\}\n/.exec(lua);
  if (!block) throw new Error("could not find S.palette block in emitted Lua");
  return [...block[1].matchAll(/^ {2}(\S+) = \{/gm)].map((m) => m[1]);
}

// Pulls the expression key names out of the emitted actor's `expr = { ... }` block, in
// emission order.
function extractExprKeys(lua: string): string[] {
  const block = /expr = \{\n([\s\S]*?)\n {4}\},/.exec(lua);
  if (!block) throw new Error("could not find expr block in emitted Lua");
  return [...block[1].matchAll(/^ {6}(\S+) = \[\[/gm)].map((m) => m[1]);
}

describe("emitSpritesLua", () => {
  const out = emitSpritesLua([TUK], PALETTE);

  it("emits the palette with rgb arrays", () => {
    expect(out).toContain("S.palette = {");
    expect(out).toContain("k = {26,28,44},");
    expect(out).toContain("w = {244,244,244},");
  });

  it("emits palette keys sorted alphabetically, not in source JSON order", () => {
    // sprites/palette.json is deliberately NOT in alphabetical order (k, d, r, o, y, ...),
    // so this pins the emitter's `Object.keys(palette).sort()` behavior rather than just
    // reflecting whatever order the source happens to be in.
    const sourceOrder = Object.keys(PALETTE);
    expect(sourceOrder).not.toEqual([...sourceOrder].sort());

    expect(extractPaletteKeys(out)).toEqual(Object.keys(PALETTE).sort());
  });

  it("emits the actor with face box, base, and expressions", () => {
    expect(out).toContain("tuk = {");
    expect(out).toContain("face = { x=6, y=4, w=16, h=10 },");
    expect(out).toContain("base = [[");
    expect(out).toContain("happy_closed = [[");
    expect(out).toContain("happy_open = [[");
  });

  it("emits expr keys sorted alphabetically", () => {
    expect(extractExprKeys(out)).toEqual(Object.keys(TUK.expr).sort());
  });

  it("is deterministic regardless of palette key insertion order", () => {
    // Build a palette object with the same entries as PALETTE but inserted in reverse
    // order. JS object key iteration follows insertion order for non-numeric string keys,
    // so if emitSpritesLua ever stopped sorting, this would produce different output than
    // the forward-ordered PALETTE. Byte-identical output here proves the emitted text
    // depends on content, not on input key order.
    const reversedPalette: Palette = {};
    for (const key of [...Object.keys(PALETTE)].reverse()) {
      reversedPalette[key] = PALETTE[key];
    }
    expect(Object.keys(reversedPalette)).not.toEqual(Object.keys(PALETTE));

    const reversedOut = emitSpritesLua([TUK], reversedPalette);
    expect(reversedOut).toBe(out);
  });
});

describe("layer art emission", () => {
  it("emits an empty S.layer_art block when no layers are passed", () => {
    expect(emitSpritesLua([TUK], PALETTE)).toContain("S.layer_art = {\n}");
  });

  it("bakes passed layers grouped by slot with their anchor offsets", () => {
    const horns = loadLayerArt(
      new URL("../sprites/layers", import.meta.url).pathname,
      "headwear",
      "horns",
      PALETTE,
    );
    const out = emitSpritesLua([TUK], PALETTE, [horns]);
    // Tracks the real horns art, which is density 2; asserting the declared
    // density round-trips proves the emitter propagates it rather than
    // defaulting.
    expect(out).toContain("S.layer_art = {\n  headwear = {\n    horns = { dx=0, dy=0, density=2, grid = [[");
    expect(out).toContain(horns.grid.join("\n"));
  });
});

const ROOT = new URL("..", import.meta.url).pathname;

describe("chunk emitters (firmware residency)", () => {
  it("emitActorChunk evaluates to the same table emitSpritesLua builds", () => {
    const chunkPath = path.join(tmpdir(), "tuk-chunk.lua");
    const simPath = path.join(tmpdir(), "tuk-sim.lua");
    writeFileSync(chunkPath, emitActorChunk(TUK));
    writeFileSync(simPath, "S = {}\n" + emitSpritesLua([TUK], PALETTE));
    const out = execFileSync("lua", ["tests/lua/deep-compare-actor.lua", simPath, chunkPath, "tuk"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out.trim()).toBe("EQUAL");
  });

  it("emitPaletteChunk is a loadable expression returning every palette key", () => {
    const p = path.join(tmpdir(), "palette-chunk.lua");
    writeFileSync(p, emitPaletteChunk(PALETTE));
    const out = execFileSync(
      "lua",
      [
        "-e",
        `local t = assert(loadfile("${p}"))(); local n = 0; for _ in pairs(t) do n = n + 1 end; print(n)`,
      ],
      { encoding: "utf8" },
    );
    expect(Number(out.trim())).toBe(Object.keys(PALETTE).length);
  });

  it("emitLayerArtLua matches the block emitSpritesLua embeds", () => {
    const horns = loadLayerArt(
      new URL("../sprites/layers", import.meta.url).pathname,
      "headwear",
      "horns",
      PALETTE,
    );
    expect(emitSpritesLua([TUK], PALETTE, [horns])).toContain(emitLayerArtLua([horns]));
  });

  // bleed_x is a build-time authoring budget, not something the compositor
  // needs: the GFX contract says the device's canvas clips on its own, though
  // that has not yet been confirmed on real hardware. gen-sprite-data emits
  // dx/dy/density/grid by name rather than spreading the object, so the field
  // stays out of the baked app -- and therefore out of the art fingerprint,
  // which is what makes declaring one a story push and never a fleet reflash.
  it("never emits bleed_x, even for a layer that declares one", () => {
    const wings = loadLayerArt(
      new URL("../sprites/layers", import.meta.url).pathname,
      "back_prop",
      "wings",
      PALETTE,
    );
    const lua = emitLayerArtLua([wings]);
    expect(lua).not.toContain("bleed");
    expect(lua).toContain("density=2");
  });

  it("fingerprint is 8 hex chars, order-independent, art-sensitive", () => {
    const ADA = loadActor(new URL("../sprites/actors/ada", import.meta.url).pathname, PALETTE);
    const fp = troupeArtFingerprint([ADA, TUK], PALETTE);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(troupeArtFingerprint([TUK, ADA], PALETTE)).toBe(fp);
    const mutated = { ...TUK, base: [...TUK.base.slice(0, -1), TUK.base.at(-1)!.replace(/^./, "k")] };
    expect(troupeArtFingerprint([ADA, mutated], PALETTE)).not.toBe(fp);
  });

  it("fingerprint changes when an actor is renamed, even with art untouched and sort order unchanged", () => {
    // emitActorChunk emits only face/base/expr -- never the id -- so a rename
    // that doesn't touch art and doesn't move the actor's position in the
    // sorted chunk order must still change the fingerprint. "tuk2" sorts
    // right after "ada", same as "tuk" does, so this isn't exercising an
    // ordering change in disguise.
    const ADA = loadActor(new URL("../sprites/actors/ada", import.meta.url).pathname, PALETTE);
    const fp = troupeArtFingerprint([ADA, TUK], PALETTE);
    const renamed = { ...TUK, id: "tuk2" };
    expect(["ada", "tuk2"]).toEqual(["ada", "tuk2"].sort());
    expect(troupeArtFingerprint([ADA, renamed], PALETTE)).not.toBe(fp);
  });
});
