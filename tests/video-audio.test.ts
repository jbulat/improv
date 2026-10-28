import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mixTrace } from "../tools/lib/video-audio";
import { encodeWav, decodeWav } from "../tools/lib/wav";
import type { PlayEvent } from "../tools/lib/sim-audio";
import { DELIVERY_SAMPLE_RATE } from "../tools/lib/delivery-format";

// These clips stand in for delivery clips, and the no-plays case below
// asserts mixTrace's default rate, which is the delivery rate itself.
const RATE = DELIVERY_SAMPLE_RATE;

/** A root holding `stories/s/<name>.wav`, mirroring how the sim stages clips. */
function root(clips: Record<string, Float32Array>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mix-"));
  mkdirSync(path.join(dir, "stories", "s"), { recursive: true });
  for (const [name, samples] of Object.entries(clips)) {
    writeFileSync(path.join(dir, "stories", "s", name), encodeWav(samples, RATE));
  }
  return dir;
}

/** A constant-amplitude clip of `ms` milliseconds. */
function tone(ms: number, amp: number): Float32Array {
  return new Float32Array(Math.round((ms * RATE) / 1000)).fill(amp);
}

const play = (p: Partial<PlayEvent> & { path: string; channel: number; atMs: number }): PlayEvent => ({
  offsetMs: 0,
  unpreloaded: false,
  ...p,
});

describe("mixTrace", () => {
  it("places a clip at its atMs", () => {
    const dir = root({ "a.wav": tone(100, 0.5) });
    const { wav } = mixTrace([play({ path: "stories/s/a.wav", channel: 0, atMs: 1000 })], {
      audioRoot: dir,
      endMs: 2000,
    });
    const { samples } = decodeWav(wav);
    expect(samples[RATE - 1]).toBeCloseTo(0, 3);
    expect(samples[RATE]).toBeCloseTo(0.5, 2);
  });

  it("attenuates channel 1 to the device's sfx balance", () => {
    const dir = root({ "s.wav": tone(100, 1.0) });
    const { wav } = mixTrace([play({ path: "stories/s/s.wav", channel: 1, atMs: 0 })], {
      audioRoot: dir,
      endMs: 200,
    });
    expect(decodeWav(wav).samples[10]).toBeCloseTo(0.4, 2);
  });

  it("truncates a narration clip at the next narration play", () => {
    // line_start stops channel 0 before playing the next line, so a clip that
    // outlasts its beat is cut on the device and must be cut here too.
    const dir = root({ "a.wav": tone(1000, 0.5), "b.wav": tone(100, 0.25) });
    const { wav } = mixTrace(
      [
        play({ path: "stories/s/a.wav", channel: 0, atMs: 0 }),
        play({ path: "stories/s/b.wav", channel: 0, atMs: 200 }),
      ],
      { audioRoot: dir, endMs: 1000 },
    );
    const { samples } = decodeWav(wav);
    expect(samples[Math.round(RATE * 0.1)]).toBeCloseTo(0.5, 2); // a, still playing
    expect(samples[Math.round(RATE * 0.25)]).toBeCloseTo(0.25, 2); // b alone, a is cut
  });

  it("does not truncate across channels", () => {
    const dir = root({ "a.wav": tone(1000, 0.5), "s.wav": tone(50, 1.0) });
    const { wav } = mixTrace(
      [
        play({ path: "stories/s/a.wav", channel: 0, atMs: 0 }),
        play({ path: "stories/s/s.wav", channel: 1, atMs: 500 }),
      ],
      { audioRoot: dir, endMs: 1000 },
    );
    // 0.5 narration + 0.4 sfx, both sounding at 600ms.
    expect(decodeWav(wav).samples[Math.round(RATE * 0.6)]).toBeCloseTo(0.5, 2);
    expect(decodeWav(wav).samples[Math.round(RATE * 0.52)]).toBeCloseTo(0.9, 2);
  });

  it("honours offsetMs", () => {
    const dir = root({ "a.wav": Float32Array.from({ length: RATE }, (_, i) => (i < RATE / 2 ? 0.2 : 0.8)) });
    const { wav } = mixTrace([play({ path: "stories/s/a.wav", channel: 0, atMs: 0, offsetMs: 600 })], {
      audioRoot: dir,
      endMs: 1000,
    });
    expect(decodeWav(wav).samples[10]).toBeCloseTo(0.8, 2);
  });

  it("reports clipping instead of silently clamping", () => {
    const dir = root({ "a.wav": tone(100, 0.9), "s.wav": tone(100, 1.0) });
    const { clipped } = mixTrace(
      [
        play({ path: "stories/s/a.wav", channel: 0, atMs: 0 }),
        play({ path: "stories/s/s.wav", channel: 1, atMs: 0 }),
      ],
      { audioRoot: dir, endMs: 200 },
    );
    expect(clipped).toBeGreaterThan(0);
  });

  it("rejects a clip whose sample rate differs from the mix", () => {
    const dir = root({ "a.wav": tone(100, 0.5) });
    writeFileSync(path.join(dir, "stories", "s", "b.wav"), encodeWav(tone(100, 0.5), 44100));
    expect(() =>
      mixTrace(
        [
          play({ path: "stories/s/a.wav", channel: 0, atMs: 0 }),
          play({ path: "stories/s/b.wav", channel: 0, atMs: 200 }),
        ],
        { audioRoot: dir, endMs: 1000 },
      ),
    ).toThrow(new RegExp(`44100.*${RATE}|sample rate`, "i"));
  });

  it("produces silence of the right length for a trace with no plays", () => {
    const dir = root({});
    const { wav, frames } = mixTrace([], { audioRoot: dir, endMs: 1000 });
    expect(frames).toBe(RATE);
    expect(decodeWav(wav).samples.every((s) => s === 0)).toBe(true);
  });
});
