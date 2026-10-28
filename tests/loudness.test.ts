import { describe, it, expect } from "vitest";
import { peakDb, speechRmsDb, normalizeToTarget } from "../tools/lib/loudness";
import { PEAK_CEILING_DB, TARGET_RMS_DB } from "../tools/lib/delivery-format";

/** A sine whose speech RMS is exactly `db` dBFS (sine RMS = amplitude / √2). */
function toneAtRms(db: number, n = 22050): Float32Array {
  const amp = Math.SQRT2 * 10 ** (db / 20);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * 440 * i) / 22050) * amp;
  return s;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("loudness measurement", () => {
  // Gating at the speech floor drops a sine's near-zero crossings, which lifts
  // the reading ~0.2 dB above the analytic A/√2. Real speech is what this
  // measures; a tone is only a sanity check, so allow that much slack.
  it("measures the RMS of a known tone", () => {
    expect(speechRmsDb(toneAtRms(-20))).toBeCloseTo(-20, 0);
  });

  it("measures peak independently of RMS", () => {
    // sine at -20 dBFS RMS peaks √2 higher, i.e. ~-17 dBFS
    expect(peakDb(toneAtRms(-20))).toBeCloseTo(-17, 1);
  });

  it("ignores silence between phrases when measuring speech RMS", () => {
    const speech = toneAtRms(-20, 11025);
    const padded = concat(new Float32Array(22050), speech, new Float32Array(22050));
    // naive whole-file RMS would read ~5 dB lower; speech RMS must not
    expect(speechRmsDb(padded)).toBeCloseTo(speechRmsDb(speech), 1);
  });

  it("reports silence as -Infinity rather than NaN", () => {
    expect(speechRmsDb(new Float32Array(1000))).toBe(-Infinity);
    expect(peakDb(new Float32Array(1000))).toBe(-Infinity);
  });
});

describe("normalizeToTarget", () => {
  // The delivery format's own pair, so this exercises the numbers that ship
  // rather than a second copy of them.
  const opts = { targetRmsDb: TARGET_RMS_DB, peakCeilingDb: PEAK_CEILING_DB };

  // Re-measuring after gain lands within ~0.05 dB of target rather than exactly
  // on it: the speech floor is absolute, so scaling changes which samples clear
  // it. Inaudible (~1 dB is the threshold), so assert to ±0.5 dB.

  it("raises a quiet clip to the target RMS", () => {
    const { samples, report } = normalizeToTarget(toneAtRms(-20), opts);
    expect(report.rmsDbBefore).toBeCloseTo(-20, 0);
    expect(report.gainDb).toBeCloseTo(opts.targetRmsDb - report.rmsDbBefore, 5);
    expect(report.gainDb).toBeGreaterThan(0);
    expect(report.ceilingLimited).toBe(false);
    expect(speechRmsDb(samples)).toBeCloseTo(-14, 0);
  });

  it("attenuates a clip that is louder than the target", () => {
    const { samples, report } = normalizeToTarget(toneAtRms(-8), opts);
    expect(report.gainDb).toBeCloseTo(opts.targetRmsDb - report.rmsDbBefore, 5);
    expect(report.gainDb).toBeLessThan(0);
    expect(speechRmsDb(samples)).toBeCloseTo(-14, 0);
  });

  it("caps gain at the peak ceiling and flags the clip as ceiling-limited", () => {
    // high crest factor: quiet body, one loud transient at -2 dBFS
    const body = toneAtRms(-26, 22050);
    body[0] = 10 ** (-2 / 20);
    const { samples, report } = normalizeToTarget(body, opts);
    expect(report.ceilingLimited).toBe(true);
    expect(report.gainDb).toBeCloseTo(1, 1); // -2 dBFS peak can only rise 1 dB
    expect(peakDb(samples)).toBeLessThanOrEqual(-1 + 0.01);
    expect(report.rmsDbAfter).toBeLessThan(opts.targetRmsDb); // fell short, honestly
  });

  it("never lets output exceed the peak ceiling", () => {
    for (const db of [-30, -25, -20, -15, -10, -5]) {
      const { samples } = normalizeToTarget(toneAtRms(db), opts);
      expect(peakDb(samples)).toBeLessThanOrEqual(opts.peakCeilingDb + 0.01);
    }
  });

  it("leaves pure silence untouched instead of dividing by zero", () => {
    const { samples, report } = normalizeToTarget(new Float32Array(1000), opts);
    expect(report.gainDb).toBe(0);
    expect(report.ceilingLimited).toBe(false);
    expect(samples.every((s) => s === 0)).toBe(true);
  });
});
