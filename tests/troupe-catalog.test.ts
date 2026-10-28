import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Troupe } from "../tools/lib/types";

const troupe: Troupe = JSON.parse(readFileSync("troupe/troupe.json", "utf8"));

describe("sfx catalog", () => {
  // The vocabulary is the contract set; the catalog is the director's
  // guidance for it. They must cover exactly the same sounds, so a future
  // vocabulary addition without usage metadata fails loudly here.
  it("documents exactly the vocabulary — no missing entries, no strays", () => {
    expect(troupe.sfx_catalog.map((s) => s.id).sort()).toEqual([...troupe.sfx_vocabulary].sort());
  });

  it("every entry says what it sounds like, when to use it, and when not to", () => {
    for (const s of troupe.sfx_catalog) {
      expect(s.sound.length, s.id).toBeGreaterThan(0);
      expect(s.use.length, s.id).toBeGreaterThan(0);
      expect(s.avoid.length, s.id).toBeGreaterThan(0);
    }
  });
});

// The layer catalog is the director's menu, and `story-create` reads it to
// decide what a role may wear. A malformed entry there misleads an author
// rather than failing a build, so its shape is asserted rather than assumed.
describe("layer catalog", () => {
  const SLOTS = ["headwear", "back_prop", "front_prop", "costume"];
  const actorIds = new Set<string>(troupe.actors.map((a) => a.id));
  const categories = new Set<string>(troupe.actors.map((a) => a.category));

  it("has no duplicate layer ids", () => {
    const ids = troupe.layers.map((l) => l.id);
    expect(ids.length, `duplicates: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`).toBe(new Set(ids).size);
  });

  it("declares a known slot for every layer", () => {
    for (const l of troupe.layers) expect(SLOTS, l.id).toContain(l.slot);
  });

  // A `fits` entry that is neither an actor id nor a category silently fits
  // NOBODY: the validator's membership test just never matches, so the layer
  // becomes uncastable rather than erroring.
  it("every fits entry names a real actor id or a real category", () => {
    for (const l of troupe.layers) {
      expect(l.fits.length, `${l.id} fits nobody`).toBeGreaterThan(0);
      for (const f of l.fits) {
        expect(
          actorIds.has(f) || categories.has(f),
          `layer "${l.id}" fits "${f}", which is neither an actor id nor a category`,
        ).toBe(true);
      }
    }
  });

  // miss_moon has no category and wears nothing, ever — a layer naming her
  // would pass the check above but break the troupe's own rule.
  it("no layer is fitted to miss_moon", () => {
    for (const l of troupe.layers) expect(l.fits, l.id).not.toContain("miss_moon");
  });

  it("every layer carries a description an author can act on", () => {
    for (const l of troupe.layers) {
      expect(l.description?.length ?? 0, `${l.id} has no description`).toBeGreaterThan(30);
    }
  });
});
