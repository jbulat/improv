import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { wavDurationMs } from "../tools/lib/wav";
import { loadBundle } from "../tools/lib/bundle";
import { cueDrifts, formatCueDrift, isMaterialDrift, DRIFT_FLOOR_MS } from "../tools/lib/cue-drift";
import type { Beat, SfxCue } from "../tools/lib/types";

function beat(index: number, lineAudio: string | null, sfx: SfxCue[]): Beat {
  return {
    index,
    character_id: "witch",
    expression: "neutral",
    text: "…",
    line_audio: lineAudio,
    sfx,
    duration_ms: 2000,
    animation: lineAudio === null ? "none" : "speak",
  };
}

describe("material drift", () => {
  it("ignores a clip that came back the same length", () => {
    // Same voice, same text: `say` renders the same clip, and every cue on it
    // still means what it meant. This is the common case and must stay quiet.
    expect(isMaterialDrift(2136, 2136)).toBe(false);
  });

  it("reports a shift at or past the floor, in either direction", () => {
    expect(isMaterialDrift(2136, 2136 - DRIFT_FLOOR_MS)).toBe(true);
    expect(isMaterialDrift(2136, 2136 + DRIFT_FLOOR_MS)).toBe(true);
    expect(isMaterialDrift(2136, 2136 - (DRIFT_FLOOR_MS - 1))).toBe(false);
  });

  it("reports a sub-floor shift that is proportionally large on a short clip", () => {
    // 60ms is under the floor but is 8% of an 800ms clip, whose cues sit in
    // proportionally tighter quarters.
    expect(isMaterialDrift(800, 740)).toBe(true);
    expect(isMaterialDrift(800, 780)).toBe(false); // 2.5%, and under the floor
  });
});

describe("cue drift over a regenerated bundle", () => {
  it("catches the aud_008 recast that SFX_PAST_END could not", () => {
    // On the real fixture: recasting the Witch from ada to rosa, a quicker
    // voice, takes aud_008 from 2136ms to the 1660ms clip on disk, and a
    // sparkle cue at 1400ms, meant to rise in the pause before "BALD!", lands
    // inside the word. 1400 < 1660, so the validator's SFX_PAST_END sees
    // nothing wrong.
    const b = loadBundle(path.join("fixtures", "lulu-and-the-fringe-that-grew-back"));
    const rosaMs = wavDurationMs(readFileSync(path.join(b.dir, "audio/aud_008.wav")));
    expect(rosaMs).toBe(1660);

    // Every clip measures as it does on disk. Only aud_008 gets its
    // pre-recast length, and its beat carries the sparkle cue at 1400ms.
    const after = new Map(
      b.perf.assets.audio
        .filter((a) => a.kind === "line")
        .map((a) => [a.id, wavDurationMs(readFileSync(path.join(b.dir, a.uri)))] as const),
    );
    const before = new Map(after);
    before.set("aud_008", 2136);
    const timeline = b.perf.timeline.map((t) =>
      t.line_audio === "aud_008" ? { ...t, sfx: [{ audio: "sfx_sparkle", at_ms: 1400 }] } : t,
    );

    const drifts = cueDrifts(timeline, before, after);
    expect(drifts).toEqual([
      {
        beatIndex: 8,
        audioId: "aud_008",
        beforeMs: 2136,
        afterMs: 1660,
        cues: [{ audio: "sfx_sparkle", at_ms: 1400 }],
      },
    ]);

    const report = formatCueDrift(drifts[0]).join("\n");
    expect(report).toContain("aud_008 (beat 8) changed 2136ms -> 1660ms (-476ms, -22.3%)");
    expect(report).toContain("sfx_sparkle at 1400ms");
    expect(report).toContain("now 260ms from the end of the clip, was 736ms");
    expect(report).toContain("not rescaled");
  });

  it("stays silent when the recast beat carries no cues", () => {
    const timeline = [beat(0, "aud_000", [])];
    const drifts = cueDrifts(timeline, new Map([["aud_000", 2136]]), new Map([["aud_000", 1649]]));
    expect(drifts).toEqual([]);
  });

  it("stays silent for a clip rendered for the first time", () => {
    // Nothing was replaced, so no cue was ever authored against an earlier
    // length — a brand-new bundle must not warn on every beat it has.
    const timeline = [beat(0, "aud_000", [{ audio: "sfx_sparkle", at_ms: 1400 }])];
    const drifts = cueDrifts(timeline, new Map(), new Map([["aud_000", 1649]]));
    expect(drifts).toEqual([]);
  });

  it("skips silent beats", () => {
    const drifts = cueDrifts(
      [beat(0, null, [{ audio: "sfx_chime", at_ms: 400 }])],
      new Map([["aud_000", 2136]]),
      new Map([["aud_000", 1649]]),
    );
    expect(drifts).toEqual([]);
  });

  it("reports every cue on a drifted beat, including one pushed past the clip", () => {
    const timeline = [
      beat(0, "aud_000", [
        { audio: "sfx_shing", at_ms: 500 },
        { audio: "sfx_chime", at_ms: 1800 },
      ]),
    ];
    const drifts = cueDrifts(timeline, new Map([["aud_000", 2000]]), new Map([["aud_000", 1600]]));
    expect(drifts[0].cues).toHaveLength(2);
    const report = formatCueDrift(drifts[0]).join("\n");
    expect(report).toContain("carries 2 sfx cues");
    expect(report).toContain("sfx_shing at 500ms — now 1100ms from the end of the clip");
    expect(report).toContain("sfx_chime at 1800ms — now 200ms PAST the end of the clip");
  });

  it("signs a clip that grew", () => {
    const timeline = [beat(0, "aud_000", [{ audio: "sfx_sparkle", at_ms: 400 }])];
    const drifts = cueDrifts(timeline, new Map([["aud_000", 1600]]), new Map([["aud_000", 2000]]));
    expect(formatCueDrift(drifts[0])[0]).toContain("1600ms -> 2000ms (+400ms, +25.0%)");
  });
});
