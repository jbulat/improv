import { describe, it, expect } from "vitest";
import { loadBundle } from "../tools/lib/bundle";
import { mixTimeline, renderStory } from "../tools/preview-audio";
import { DELIVERY_SAMPLE_RATE } from "../tools/lib/delivery-format";

describe("mixTimeline", () => {
  const rate = 1000; // 1 frame == 1ms, keeps the arithmetic legible

  it("places a line clip at its beat's start (running sum of durations)", () => {
    const clips = new Map([
      ["a", Float32Array.from([1, 1])],
      ["b", Float32Array.from([1, 1])],
    ]);
    const mix = mixTimeline(
      [
        { duration_ms: 5, line_audio: "a", sfx: [] },
        { duration_ms: 5, line_audio: "b", sfx: [] },
      ],
      clips,
      rate,
    );
    expect(mix.durationMs).toBe(10);
    expect(mix.samples[0]).toBe(1); // clip a at t=0
    expect(mix.samples[5]).toBe(1); // clip b at t=5ms
    expect(mix.samples[2]).toBe(0); // silence between
  });

  it("places an sfx cue at beat start + at_ms", () => {
    const mix = mixTimeline(
      [{ duration_ms: 10, line_audio: null, sfx: [{ audio: "s", at_ms: 3 }] }],
      new Map([["s", Float32Array.from([0.5])]]),
      rate,
    );
    expect(mix.samples[3]).toBe(0.5);
  });

  it("mixes overlapping clips additively and clamps to [-1, 1]", () => {
    const mix = mixTimeline(
      [{ duration_ms: 2, line_audio: "a", sfx: [{ audio: "b", at_ms: 0 }] }],
      new Map([
        ["a", Float32Array.from([0.8])],
        ["b", Float32Array.from([0.8])],
      ]),
      rate,
    );
    expect(mix.samples[0]).toBe(1); // 0.8 + 0.8 clamped
  });

  it("extends the buffer when an sfx tail runs past the final beat", () => {
    const mix = mixTimeline(
      [{ duration_ms: 2, line_audio: null, sfx: [{ audio: "s", at_ms: 1 }] }],
      new Map([["s", Float32Array.from([0.1, 0.1, 0.1, 0.1])]]), // ends at t=5, beat ends at 2
      rate,
    );
    expect(mix.samples).toHaveLength(5);
    expect(mix.durationMs).toBe(2); // reported duration is still the timeline length
  });

  it("throws on a referenced clip that has no decoded samples", () => {
    expect(() => mixTimeline([{ duration_ms: 1, line_audio: "missing", sfx: [] }], new Map(), rate)).toThrow(
      /missing/,
    );
  });
});

describe("renderStory (real fixture)", () => {
  it("renders the knight bundle to non-silent audio the length of the timeline", () => {
    const bundle = loadBundle("fixtures/knight-and-lonely-dragon");
    const mix = renderStory(bundle);
    const timelineMs = bundle.perf.timeline.reduce((s, b) => s + b.duration_ms, 0);
    expect(mix.durationMs).toBe(timelineMs);
    // The mix adopts the first clip's rate, and every bundle clip is in the
    // delivery format. Named rather than re-typed, so it cannot drift.
    expect(mix.sampleRate).toBe(DELIVERY_SAMPLE_RATE);
    const peak = mix.samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(peak).toBeGreaterThan(0); // real clips got mixed in, not all silence
  });
});
