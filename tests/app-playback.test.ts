// Player behavior the device suite doesn't cover: the full state walk, pause
// freezing, per-beat timing precision, sfx cue timing, and headwear
// compositing. Runs the device bundle (the only build), so every harness gets
// the troupe stub that stands in for resident art.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildApp } from "../tools/build-app";
import { emitTroupeStubLua } from "../tools/gen-troupe-header";

const stubDir = mkdtempSync(path.join(tmpdir(), "troupe-stub-"));
const troupeStubPath = path.join(stubDir, "troupe-stub.lua");
writeFileSync(troupeStubPath, emitTroupeStubLua());

// Ground truth from fixtures/knight-and-lonely-dragon/performance.json. The
// device runs on_tick at 10 FPS, so every event lands on a 100 ms boundary at
// or after its ideal time -- never before it, and never a whole tick late.
const TITLE_MS = 2000;
const TICK_MS = 100;
const DURATIONS = [3550, 4030, 1900, 3950, 2860, 2290, 1800, 2260, 1800, 1910, 3120, 2630, 1980, 1910, 3450];

/** Absolute story ms at which 0-based beat `i` begins. */
const beatStart = (i: number) => TITLE_MS + DURATIONS.slice(0, i).reduce((a, b) => a + b, 0);

// Sfx cue onsets, in the order the player triggers them: the restart chime at
// story 0, then each beat's cue at `beatStart(beat) + at`.
const CUES: { id: string; ideal: number }[] = [
  { id: "sfx_chime", ideal: 0 },
  { id: "sfx_whoosh", ideal: beatStart(1) + 420 },
  { id: "sfx_roar", ideal: beatStart(5) + 0 },
  { id: "sfx_shing", ideal: beatStart(7) + 270 },
  { id: "sfx_fire", ideal: beatStart(8) + 0 },
  { id: "sfx_chime", ideal: beatStart(13) + 900 },
  { id: "sfx_chime", ideal: beatStart(14) + 0 },
];

describe("full performance playback (headless)", () => {
  const { outPath } = buildApp("player", "fixtures/knight-and-lonely-dragon");
  const out = execFileSync("lua", ["tests/lua/run-playback.lua", outPath, troupeStubPath], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });

  /** Asserts `actual` is the first tick boundary at or after `ideal`. */
  const expectWithinOneTick = (label: string, actual: number, ideal: number) => {
    const lag = actual - ideal;
    const msg = `${label}: at ${actual} ms, ideal ${ideal} ms (lag ${lag} ms)`;
    expect(lag, msg).toBeGreaterThanOrEqual(0);
    expect(lag, msg).toBeLessThanOrEqual(TICK_MS);
  };

  it("walks title -> all 15 beats in order -> done", () => {
    const t = /TRANSITIONS (.+)/.exec(out)![1].split(" ");
    const expected = ["title:1", "playing:1", "paused:1", "playing:1"];
    for (let i = 2; i <= 15; i++) expected.push(`playing:${i}`);
    expected.push("done:15");
    expect(t).toEqual(expected);
    expect(out).toContain("STATE done");
  });

  it("freezes while paused", () => {
    expect(out).toContain("PAUSE_FROZEN true");
  });

  it("plays every sfx cue exactly once", () => {
    // title chime + whoosh + roar + shing + fire + chime + chime, one
    // channel-1 audio.play each (the resume replay is channel 0 only).
    expect(out).toContain("SFX_PLAYS 7");
  });

  it("button 0 restarts from done", () => {
    expect(out).toContain("RESTART title");
  });

  it("calls line_start once per beat and sound_stop on init/pause/restart", () => {
    const m = /LINE_STARTS (\d+) (\S+)/.exec(out)!;
    expect(Number(m[1])).toBe(15); // one per beat, silent beat included
    expect(m[2].split(",")[0]).toBe("aud_000");
    expect(m[2].split(",")).toContain("-"); // the breathes-fire beat has no line
    // Counted at print time (before the harness's restarts): init reset + 1 pause
    expect(Number(/SOUND_STOPS (\d+)/.exec(out)![1])).toBe(2);
  });

  it("sounds every sfx gesture within one tick of its cue point", () => {
    const onsets = [...out.matchAll(/SFX_ONSET (\S+) (-?\d+)/g)].map((m) => ({
      id: m[1],
      at: Number(m[2]),
    }));
    // Ids AND count must match: a dropped or doubled cue fails here before
    // any timing is checked.
    expect(onsets.map((o) => o.id)).toEqual(CUES.map((c) => c.id));

    for (const [i, cue] of CUES.entries()) {
      expectWithinOneTick(`${cue.id} #${i + 1}`, onsets[i].at, cue.ideal);
    }
  });

  it("advances each beat at its fixture duration", () => {
    const at = Object.fromEntries(
      /BEAT_AT (.+)/
        .exec(out)![1]
        .split(" ")
        .map((p) => p.split(":").map(Number) as [number, number]),
    );
    expect(Object.keys(at)).toHaveLength(DURATIONS.length);

    for (let i = 0; i < DURATIONS.length; i++) {
      expectWithinOneTick(`beat ${i + 1} start`, at[i + 1], beatStart(i));
    }
    const total = beatStart(DURATIONS.length);
    expect(total).toBe(41440);
    expectWithinOneTick("done", Number(/DONE_AT (-?\d+)/.exec(out)![1]), total);
  });

  it("draws no subtitle strip: no text wider than the portrait layout allows", () => {
    expect(Number(/MAX_TEXT_LEN (\d+)/.exec(out)![1])).toBeLessThanOrEqual(20);
  });
});

describe("headwear compositing (headless)", () => {
  const { outPath } = buildApp("player", "fixtures/knight-and-lonely-dragon");
  const out = execFileSync("lua", ["tests/lua/run-headwear.lua", outPath, troupeStubPath], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });

  it("the dragon's horns add draw runs on top of the bare actor", () => {
    expect(Number(/HEADWEAR_DELTA (\d+)/.exec(out)![1])).toBeGreaterThan(0);
  });

  it("headwear never changes the grounded footprint", () => {
    expect(out).toContain("BOTTOM_UNCHANGED true");
  });

  it("unknown layer ids and empty layer tables draw the bare sprite", () => {
    expect(out).toContain("FORGIVING true");
  });
});
