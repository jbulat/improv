// trimQuiet cuts the quiet ends of a line clip, so the mouth stops with the
// voice (see tools/gen-line-audio.ts).
import { describe, expect, it } from "vitest";
import { trimQuiet } from "../tools/lib/loudness";

const RATE = 16000;
const OPTS = { belowSpeechDb: 20, padMs: 80, fadeMs: 15 };
const ms = (n: number) => Math.round((n * RATE) / 1000);

/** Spans of [level, ms]: a tone at that peak level, or silence at 0. */
function clip(spans: [number, number][]): Float32Array {
  const out: number[] = [];
  for (const [level, len] of spans) {
    for (let i = 0; i < ms(len); i++) out.push(level * Math.sin((2 * Math.PI * 300 * out.length) / RATE));
  }
  return Float32Array.from(out);
}

describe("trimQuiet", () => {
  it("cuts a quiet tail and lead-in down to the pad", () => {
    // -46 dB hiss either side of speech at -14 dB: 32 dB under, so quiet.
    const hiss = 0.005;
    const out = trimQuiet(
      clip([
        [hiss, 300],
        [0.2, 1000],
        [hiss, 700],
      ]),
      RATE,
      OPTS,
    );
    expect(out.length).toBeGreaterThanOrEqual(ms(1000));
    expect(out.length).toBeLessThanOrEqual(ms(1000 + 2 * 80 + 20));
  });

  it("keeps a pause between words", () => {
    const out = trimQuiet(
      clip([
        [0.2, 400],
        [0, 300],
        [0.2, 400],
      ]),
      RATE,
      OPTS,
    );
    expect(out.length).toBe(ms(1100));
  });

  it("keeps a soft ending under 20 dB down", () => {
    // A final consonant 12 dB under the speech is still speech.
    const out = trimQuiet(
      clip([
        [0.2, 800],
        [0.05, 200],
        [0, 500],
      ]),
      RATE,
      OPTS,
    );
    expect(out.length).toBeGreaterThanOrEqual(ms(1000));
    expect(out.length).toBeLessThanOrEqual(ms(1000 + 80 + 10));
  });

  it("fades the new edges to silence", () => {
    const out = trimQuiet(
      clip([
        [0, 500],
        [0.2, 1000],
        [0, 500],
      ]),
      RATE,
      OPTS,
    );
    expect(Math.abs(out[0])).toBe(0);
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01);
  });

  it("returns silence unchanged", () => {
    const silent = new Float32Array(ms(500));
    expect(trimQuiet(silent, RATE, OPTS)).toBe(silent);
  });
});
