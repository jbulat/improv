// The delivery format has one home, and nothing else may hold a copy of it.
//
// The second half of this file is the half that matters: it compares every
// clip to the contract and fails if any other source holds a copy of the
// numbers. A module alone cannot catch clips drifting off the rate; a module
// plus these two sweeps can.
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  DELIVERY_AUDIO_FORMAT,
  DELIVERY_BITS_PER_SAMPLE,
  DELIVERY_CHANNELS,
  DELIVERY_SAMPLE_RATE,
  PEAK_CEILING_DB,
  SPEECH_FLOOR_DB,
  SPEECH_FLOOR_LINEAR,
  TARGET_RMS_DB,
  assertDeliveryFormat,
  deliveryFormatViolations,
} from "../tools/lib/delivery-format";
import { encodeWav, readWavFormat } from "../tools/lib/wav";
import { decodeWav } from "../tools/lib/wav";
import { peakDb } from "../tools/lib/loudness";
import { bundleDirs, loadBundle } from "../tools/lib/bundle";

// Every clip a bundle's manifest names, read from disk. Not `git ls-files`:
// the spoken clips are gitignored (rendered by macOS say, or stand-ins on a
// machine without it), and they are the clips this sweep most needs to see.
const manifestClips = (): string[] =>
  bundleDirs().flatMap((d) => {
    const { perf, dir } = loadBundle(d);
    return perf.assets.audio.filter((a) => !a.uri.includes("://")).map((a) => path.join(dir, a.uri));
  });

describe("the contract's numbers", () => {
  it("pin 16 kHz mono 16-bit PCM and the loudness targets", () => {
    expect(DELIVERY_SAMPLE_RATE).toBe(16000);
    expect(DELIVERY_CHANNELS).toBe(1);
    expect(DELIVERY_BITS_PER_SAMPLE).toBe(16);
    expect(DELIVERY_AUDIO_FORMAT).toBe(1);
    expect(TARGET_RMS_DB).toBe(-14);
    expect(PEAK_CEILING_DB).toBe(-1);
    expect(SPEECH_FLOOR_DB).toBe(-40);
  });

  it("derives the speech gate's linear threshold from its dB value", () => {
    expect(SPEECH_FLOOR_LINEAR).toBeCloseTo(0.01, 12);
  });
});

describe("deliveryFormatViolations", () => {
  it("passes a conformant clip", () => {
    const wav = encodeWav(new Float32Array(DELIVERY_SAMPLE_RATE), DELIVERY_SAMPLE_RATE);
    expect(deliveryFormatViolations(wav)).toEqual([]);
    expect(() => assertDeliveryFormat(wav, "silence")).not.toThrow();
  });

  it("names the rate when it is wrong, and says what was expected", () => {
    const wav = encodeWav(new Float32Array(100), 22050);
    expect(deliveryFormatViolations(wav)).toEqual([{ field: "sampleRate", expected: 16000, actual: 22050 }]);
    expect(() => assertDeliveryFormat(wav, "old.wav")).toThrow(
      /old\.wav.*sampleRate is 22050, expected 16000/,
    );
  });

  it("reports every violation, not just the first", () => {
    // Stereo, 8-bit, IMA ADPCM, at the wrong rate: all four at once.
    const wav = encodeWav(new Float32Array(100), 44100);
    wav.writeUInt16LE(17, 20); // audioFormat
    wav.writeUInt16LE(2, 22); // channels
    wav.writeUInt16LE(8, 34); // bits per sample
    expect(deliveryFormatViolations(wav).map((v) => v.field)).toEqual([
      "audioFormat",
      "channels",
      "sampleRate",
      "bitsPerSample",
    ]);
  });

  it("walks the chunk list rather than assuming fmt and data are adjacent", () => {
    // Clips converted by afconvert carry an FLLR padding chunk between them.
    const base = encodeWav(new Float32Array(10), DELIVERY_SAMPLE_RATE);
    const head = base.subarray(0, 36); // RIFF..fmt
    const tail = base.subarray(36); // data chunk
    const fllr = Buffer.alloc(8 + 16);
    fllr.write("FLLR", 0);
    fllr.writeUInt32LE(16, 4);
    const padded = Buffer.concat([head, fllr, tail]);
    padded.writeUInt32LE(padded.length - 8, 4); // fix the RIFF size
    expect(readWavFormat(padded).sampleRate).toBe(DELIVERY_SAMPLE_RATE);
    expect(deliveryFormatViolations(padded)).toEqual([]);
  });
});

describe("every manifest clip conforms", () => {
  const clips = manifestClips();

  it("finds the clips at all (a sweep over nothing proves nothing)", () => {
    // The floor only has to catch a sweep that found nothing, not track the
    // fleet.
    expect(clips.length).toBeGreaterThan(150);
    const missing = clips.filter((f) => !existsSync(f));
    expect(missing, "render them: npm run gen:audio:all").toEqual([]);
  });

  it("is the delivery format, header for header", () => {
    const off = clips
      .map((f) => ({ f, v: deliveryFormatViolations(readFileSync(f)) }))
      .filter((r) => r.v.length > 0)
      .map((r) => `${r.f}: ${r.v.map((v) => `${v.field}=${v.actual}`).join(",")}`);
    expect(off).toEqual([]);
  });

  it("sits under the peak ceiling — sfx included, and never normalised to reach it", () => {
    const over = clips
      .map((f) => ({ f, peak: peakDb(decodeWav(readFileSync(f)).samples) }))
      .filter((r) => r.peak > PEAK_CEILING_DB)
      .map((r) => `${r.f} at ${r.peak.toFixed(2)} dBFS`);
    expect(over).toEqual([]);
  });
});

describe("nothing else hard-codes the delivery format", () => {
  // The drift guard. Without it, "one home" is a claim in a comment; with it,
  // a second copy of any of these numbers fails the build.
  const HOME = "tools/lib/delivery-format.ts";
  const sources = (): string[] =>
    execSync("git ls-files 'tools/*.ts' 'tools/**/*.ts'", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => f && f !== HOME);

  /** Blank out comments, keeping line numbering, so the guard reads code and
   *  not prose. A comment may mention 22050; a live literal must not exist. */
  const codeLines = (src: string): string[] =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""));

  const scan = (re: RegExp): string[] => {
    const hits: string[] = [];
    for (const f of sources()) {
      for (const [i, line] of codeLines(readFileSync(f, "utf8")).entries()) {
        if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    }
    return hits;
  };

  it("carries no bare sample-rate literal outside the one home", () => {
    // Every common rate, so a drift toward any of them is caught, not only a
    // drift back to 22050.
    expect(scan(/\b(8000|11025|12000|16000|22050|24000|32000|44100|48000)\b/)).toEqual([]);
  });

  it("declares no second loudness target, ceiling or speech gate", () => {
    expect(scan(/\b(TARGET_RMS_DB|PEAK_CEILING_DB|SPEECH_FLOOR_DB|SPEECH_FLOOR_LINEAR)\s*=/)).toEqual([]);
  });

  it("catches a literal that a comment would have hidden", () => {
    // Proves the comment-stripping above did not defang the guard.
    const stripped = codeLines("const RATE = 22050; // was 16000\n// only 44100 here").join("\n");
    expect(stripped).toMatch(/const RATE = 22050;/);
    expect(stripped).not.toMatch(/44100/);
  });
});
