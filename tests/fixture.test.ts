import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validatePerformance } from "../tools/lib/validator";
import { bundleDirs, loadBundle } from "../tools/lib/bundle";
import type { Troupe } from "../tools/lib/types";

const troupe: Troupe = JSON.parse(readFileSync("troupe/troupe.json", "utf8"));
const dirs = bundleDirs();

describe("story bundles", () => {
  it("discovers at least one bundle", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  for (const dir of dirs) {
    const b = loadBundle(dir);

    it(`${b.name} is a valid Performance (manifest only)`, () => {
      const r = validatePerformance(b.perf, troupe);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it(`${b.name} passes file checks: every WAV exists and durations are measured truth`, () => {
      const r = validatePerformance(b.perf, troupe, { checkFilesDir: b.dir });
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }
});

describe("the Knight and the Lonely Dragon fixture", () => {
  it("has the full 15-beat Draft A timeline", () => {
    const perf = loadBundle("fixtures/knight-and-lonely-dragon").perf;
    expect(perf.timeline).toHaveLength(15);
    expect(perf.cast).toHaveLength(4);
  });
});

describe("the Meet the Improv Troupe fixture", () => {
  it("casts the entire troupe, each actor playing themselves", () => {
    const perf = loadBundle("fixtures/meet-the-troupe").perf;
    expect(perf.timeline).toHaveLength(19);
    expect(perf.cast).toHaveLength(7);
    for (const c of perf.cast) expect(c.character_id).toBe(c.actor);
  });

  // Tuk's three beats stage the reveal in two steps, and the split is the
  // point: he introduces himself bare, the horns go on while he is still
  // talking, and only the last beat breathes. Fire is a one-word event, not a
  // costume: carried across the whole reveal, he would breathe fire through a
  // sentence. That last beat is also the only place `fire` and its
  // `sfx_fire` cue are allowed to disagree, so assert they land together.
  it("stages Tuk's reveal as horns first, then fire on its own beat", () => {
    const perf = loadBundle("fixtures/meet-the-troupe").perf;
    expect(perf.cast.find((c) => c.character_id === "tuk")?.layers).toBeUndefined();
    const [intro, horns, dragon] = perf.timeline.filter((b) => b.character_id === "tuk");
    expect(intro.layers).toBeUndefined();
    expect(horns.layers).toEqual({ headwear: "horns" });
    expect(dragon.layers).toEqual({ headwear: "horns", front_prop: "fire" });
    // The flame appears for the whole beat, so the cue has to be at its start.
    expect(dragon.sfx).toEqual([{ audio: "sfx_fire", at_ms: 0 }]);
  });

  // Milo's pair is the story's demo of two slots filling at once -- the one
  // place a headwear and a front_prop are staged on the same beat, which is
  // what makes it the reference for slot composition rather than for either
  // slot alone.
  it("dresses Milo's reveal in both a headwear and a front_prop", () => {
    const perf = loadBundle("fixtures/meet-the-troupe").perf;
    expect(perf.cast.find((c) => c.character_id === "milo")?.layers).toBeUndefined();
    const [intro, knight] = perf.timeline.filter((b) => b.character_id === "milo");
    expect(intro.layers).toBeUndefined();
    expect(knight.layers).toEqual({ headwear: "helmet", front_prop: "sword" });
  });

  // Pip's run is a list read across three beats -- "A dog." / "or a cat," /
  // "or a rabbit!" -- and only the last of them is a payoff, so only the last
  // one holds. Every other speaking beat in the fleet lasts exactly its clip
  // plus gen-line-audio's 300ms SPEAK_TAIL_MS; this one carries a further
  // 300ms so the ears are still on screen once the line stops.
  //
  // The hold is on `duration_ms` and deliberately NOT on the clip. Mouth-flap
  // runs while `elapsed < line_ms` (player.lua's S.mouth_open), and line_ms is
  // the clip length -- so padding the WAV with silence, the obvious way to
  // lengthen a beat, would leave Pip mouthing at the camera through three
  // empty flap windows. Lengthening the beat instead stops the mouth with the
  // audio and holds the pose.
  //
  // Asserted because `gen:audio --write-durations` rewrites every speaking
  // beat to clip + 300 and would quietly take this back on the next re-render.
  // If it fails, restore the hold rather than retuning the number.
  it("holds Pip's rabbit reveal 300ms past the end of its line, and holds nothing else", () => {
    const perf = loadBundle("fixtures/meet-the-troupe").perf;
    const clipMs = (id: string | null) => perf.assets.audio.find((a) => a.id === id)!.duration_ms;
    const pip = perf.timeline.filter((b) => b.character_id === "pip");
    expect(pip.map((b) => b.layers?.headwear)).toEqual([undefined, "whiskers", "rabbit"]);
    const [dog, cat, rabbit] = pip;
    expect(rabbit.duration_ms - clipMs(rabbit.line_audio)).toBe(600);
    expect(dog.duration_ms - clipMs(dog.line_audio)).toBe(300);
    expect(cat.duration_ms - clipMs(cat.line_audio)).toBe(300);
  });
});
