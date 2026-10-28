import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { emitPerformanceLua, foldAscii } from "../tools/gen-performance-data";
import { bundleDirs, loadBundle } from "../tools/lib/bundle";
import type { Performance } from "../tools/lib/types";

const bundles = bundleDirs().map(loadBundle);

describe("foldAscii", () => {
  it("folds typographic chars to ASCII", () => {
    expect(foldAscii("waiting…")).toBe("waiting...");
    expect(foldAscii("Wait — why?")).toBe("Wait - why?");
    expect(foldAscii("‘hi’ “there”")).toBe("'hi' \"there\"");
  });

  it("throws on unfoldable non-ASCII", () => {
    expect(() => foldAscii("naïve")).toThrow(/non-ASCII/);
  });
});

for (const b of bundles) {
  describe(`emitPerformanceLua (${b.name})`, () => {
    const perf = b.perf;
    const out = emitPerformanceLua(perf, b.name);

    it("emits the bundle's title and a bracket-indexed key for every cast member", () => {
      expect(out).toContain(`title = ${JSON.stringify(perf.title)}`);
      for (const member of perf.cast) {
        expect(out).toContain(`[${JSON.stringify(member.character_id)}] = { actor =`);
      }
    });

    it("emits one Lua table per beat in the timeline", () => {
      expect(out.match(/\{ character = /g)?.length).toBe(perf.timeline.length);
    });

    it("emits a bracket-indexed cast key for a Lua reserved word id, and the chunk loads in real Lua", () => {
      const reservedPerf: Performance = structuredClone(perf);
      reservedPerf.cast[0].character_id = "end";
      const reservedOut = emitPerformanceLua(reservedPerf, b.name);

      // The reserved word must appear as a bracketed, quoted key, never as a bare identifier.
      expect(reservedOut).toContain('["end"] = { actor =');
      expect(reservedOut).not.toMatch(/(^|[^"\w])end = \{ actor =/);

      const dir = mkdtempSync(join(tmpdir(), "gen-performance-data-"));
      try {
        const luaFile = join(dir, "chunk.lua");
        writeFileSync(luaFile, `S = {}\n${reservedOut}\nprint(S.performance.cast["end"].actor)\n`);
        // If the emitted chunk were a bare `end = {...}` key, this would be a Lua syntax
        // error and execFileSync would throw. A clean run with the expected stdout proves
        // the reserved-word id round-trips through a real Lua interpreter.
        const stdout = execFileSync("lua", [luaFile], { encoding: "utf8" });
        expect(stdout.trim()).toBe(reservedPerf.cast[0].actor);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("sorts a beat's sfx cues ascending by at_ms, regardless of source order", () => {
      // player.lua's cue loop walks each beat's sfx array with a monotonic cursor
      // (p.sfx_next) that only ever advances: it fires cue N only once cue N-1 has
      // fired, and never backtracks. That's correct only if cues are sorted ascending
      // by at -- which the schema and validator do not enforce. The emitter must
      // restore that order at build time regardless of how the source lists cues.
      const unsortedPerf: Performance = structuredClone(perf);
      unsortedPerf.timeline[0].sfx = [
        { audio: "sfx_chime", at_ms: 500 },
        { audio: "sfx_whoosh", at_ms: 100 },
      ];
      const unsortedOut = emitPerformanceLua(unsortedPerf, b.name);

      expect(unsortedOut).toContain(
        'sfx = { { id = "sfx_whoosh", at = 100 }, { id = "sfx_chime", at = 500 } }',
      );
      expect(unsortedOut).not.toContain(
        'sfx = { { id = "sfx_chime", at = 500 }, { id = "sfx_whoosh", at = 100 } }',
      );
    });
  });
}

// These assertions are measured ground truth about the knight fixture's specific
// performance.json and audio manifest -- not properties that hold for any bundle.
// Re-deriving the expected values from the bundle itself would turn them into
// tautologies, so they stay pinned to the knight story rather than looping.
describe("emitPerformanceLua (knight-and-lonely-dragon golden values)", () => {
  const perf = loadBundle("fixtures/knight-and-lonely-dragon").perf;
  const out = emitPerformanceLua(perf, "knight-and-lonely-dragon");

  it("emits durations, sfx offsets, and line_ms from the audio manifest", () => {
    // beat 1: whoosh at 420, line aud_001 is 3730 ms
    expect(out).toContain('{ id = "sfx_whoosh", at = 420 }');
    expect(out).toContain("line_ms = 3730");
    // beat 8 is silent: no line_ms on the breathes-fire beat
    expect(out).toContain(
      'text = "(breathes fire)", duration = 1800, animation = "none", layers = { front_prop = "fire", headwear = "horns" }, sfx =',
    );
  });

  it("folds the fixture's typographic text", () => {
    expect(out).toContain("something was waiting...");
    expect(out).toContain("Wait - why are you so angry?");
    expect(out).not.toMatch(/[…—]/);
  });

  it("emits audio_root, the sorted clip manifest, and per-beat line ids", () => {
    expect(out).toContain('audio_root = "stories/knight-and-lonely-dragon"');
    // 19 manifest entries: 14 line clips + 5 sfx
    expect(out).toContain('clips = { "aud_000", "aud_001",');
    expect(out.match(/clips = \{ ([^}]+) \}/)![1].split(", ").length).toBe(19);
    // beat 1 speaks aud_001
    expect(out).toContain('line = "aud_001", line_ms = 3730');
    // the silent breathes-fire beat has no line id (line/line_ms are emitted
    // together, so the existing golden line above already implies their absence)
    expect(out).toContain(
      'text = "(breathes fire)", duration = 1800, animation = "none", layers = { front_prop = "fire", headwear = "horns" }, sfx =',
    );
  });
});

describe("cast layer emission", () => {
  const knight = bundles.find((b) => b.name === "knight-and-lonely-dragon")!;
  const out = emitPerformanceLua(knight.perf, knight.name);

  it("bakes the dragon's horns, the knight's helmet and sword, and leaves bare members without a layers table", () => {
    expect(out).toContain(
      '["dragon"] = { actor = "tuk", name = "the dragon", default_expression = "neutral", layers = { headwear = "horns" } },',
    );
    // Two slots on one member, emitted in slot-name order.
    expect(out).toContain(
      '["knight"] = { actor = "milo", name = "Sir Milo", default_expression = "neutral", layers = { front_prop = "sword", headwear = "helmet" } },',
    );
    expect(out).toContain(
      '["miss_moon"] = { actor = "miss_moon", name = "Miss Moon", default_expression = "happy" },',
    );
  });

  it("omits the layers table for a member whose slots are all null, and only that member", () => {
    const perf = structuredClone(knight.perf);
    const dragon = perf.cast.find((c) => c.character_id === "dragon")!;
    dragon.layers = { headwear: null };
    const bare = emitPerformanceLua(perf, knight.name);
    expect(bare).toContain(
      '["dragon"] = { actor = "tuk", name = "the dragon", default_expression = "neutral" },',
    );
    // Nulling the dragon's own slots must not touch anyone else's layers table:
    // the princess still bakes her tiara.
    expect(bare).toContain(
      '["princess"] = { actor = "rosa", name = "Princess Rosa", default_expression = "neutral", layers = { headwear = "tiara" } },',
    );
  });
});
