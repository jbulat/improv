// What the cast actually wears, asserted against the shipped bundles.
//
// The catalog tests prove a layer CAN be worn; these prove the stories dress
// their roles the way the story needs. `just-you-wait` is the one that earns
// this: its whole point is a caterpillar becoming a butterfly, and the change
// is carried entirely by layers on two beats. A silent edit that dropped one
// half of that reveal would leave the story building, validating and playing
// — just without its climax.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Performance } from "../tools/lib/types";

const perf = (name: string): Performance =>
  JSON.parse(readFileSync(`fixtures/${name}/performance.json`, "utf8"));

describe("just-you-wait costumes", () => {
  const p = perf("just-you-wait");
  const cast = (id: string) => p.cast.find((c) => c.character_id === id)!;
  const beats = (id: string) => p.timeline.filter((b) => b.character_id === id);

  it("casts a caterpillar and a ladybug on the actors the catalog allows", () => {
    expect(cast("caterpillar").actor).toBe("rosa");
    expect(cast("ladybug").actor).toBe("pip");
  });

  // The ladybug is a bug for the whole story, so her costume is a COSTUME —
  // on the cast entry, not a beat override. Nothing should ever strip it.
  it("the ladybug wears antennae and wings throughout, from her cast entry", () => {
    expect(cast("ladybug").layers).toEqual({ headwear: "antennae", back_prop: "wings" });
    const stripped = beats("ladybug").filter((b) => b.layers !== undefined);
    expect(
      stripped.map((b) => b.index),
      "the ladybug's costume is constant; no beat should override it",
    ).toEqual([]);
  });

  // The caterpillar starts bare. If she carried the reveal on her cast entry
  // she would be a butterfly from beat 0 and the story would give itself away.
  it("the caterpillar starts with no costume at all", () => {
    expect(cast("caterpillar").layers ?? null).toBeNull();
  });

  // The reveal is a MATCHED PAIR. Wings alone read as a girl with wings;
  // antennae alone read as a bug that never transformed. Every beat that
  // carries one must carry the other.
  it("the reveal beats carry antennae and wings together, never one alone", () => {
    const revealed = beats("caterpillar").filter((b) => b.layers);
    expect(revealed.length, "the caterpillar never transforms").toBeGreaterThan(0);
    for (const b of revealed) {
      expect(b.layers, `beat ${b.index} is half a reveal`).toEqual({
        headwear: "antennae",
        back_prop: "wings",
      });
    }
  });

  // The transformation has to happen ON SCREEN. If her first line already
  // wore the costume there would be no before to compare the after against.
  it("the caterpillar speaks bare before she is ever revealed", () => {
    const hers = beats("caterpillar");
    const firstReveal = hers.findIndex((b) => b.layers);
    expect(firstReveal, "she is revealed on her very first line").toBeGreaterThan(0);
    for (const b of hers.slice(0, firstReveal)) {
      expect(b.layers ?? null, `beat ${b.index} reveals her early`).toBeNull();
    }
  });

  // Once she is a butterfly she stays one: the reveal must not flicker off
  // and back on across her remaining lines.
  it("the reveal never reverts once it has happened", () => {
    const hers = beats("caterpillar");
    const firstReveal = hers.findIndex((b) => b.layers);
    if (firstReveal < 0) return;
    for (const b of hers.slice(firstReveal)) {
      expect(b.layers, `beat ${b.index} un-reveals her`).toBeTruthy();
    }
  });
});
