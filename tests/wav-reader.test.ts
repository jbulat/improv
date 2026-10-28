// Host test for the firmware's WAV parser (device/lib/drivers/src/WavReader.h).
// Compiles a tiny C++ harness with the system compiler, feeds it the knight
// fixture's WAVs plus one afconvert WAV (which carries afconvert's FLLR padding
// chunk) and crafted bad buffers, and cross-checks durations against
// tools/lib/wav.ts.
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeWav, wavDurationMs } from "../tools/lib/wav";

const FIXTURE_AUDIO_DIR = "fixtures/knight-and-lonely-dragon/audio";
// afconvert writes a FLLR padding chunk before "data", as gen:audio's clips had
// while macOS `say` rendered them. The clips now come from ffmpeg, which writes
// none, so this committed file — the synthesized chime, put through afconvert
// once — is the one WAV that is sure to have that layout.
const AFCONVERT_WAV = "tests/helpers/afconvert-chime.wav";
const HARNESS_SRC = "tests/helpers/wav-reader-harness.cpp";

let workDir: string;
let bin: string;

type ParseResult =
  { ok: true; sampleRate: number; dataOffset: number; dataBytes: number } | { ok: false; error: string };

function runHarness(wavPath: string): ParseResult {
  const out = execFileSync(bin, [wavPath], { encoding: "utf8" }).trim();
  const parts = out.split(" ");
  if (parts[0] === "ok") {
    return {
      ok: true,
      sampleRate: Number(parts[1]),
      dataOffset: Number(parts[2]),
      dataBytes: Number(parts[3]),
    };
  }
  return { ok: false, error: parts[1] };
}

let scratchCount = 0;
function parseBuffer(buf: Buffer): ParseResult {
  const p = path.join(workDir, `case-${scratchCount++}.bin`);
  writeFileSync(p, buf);
  return runHarness(p);
}

function toneWav(): Buffer {
  const rate = 22050;
  const samples = new Float32Array(rate / 2); // half a second
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5;
  }
  return encodeWav(samples, rate);
}

// Vitest's default 10s hook timeout is not enough headroom for a real C++
// compile. This one takes ~2s idle (~3.5s cold), but under the parallel load
// of `npm test` it can overrun 10s, and then every test in this file reports
// as skipped, which reads like a suite failure rather than a slow machine.
// 120s is ~60x the idle cost.
beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "wav-reader-"));
  bin = path.join(workDir, "wav-reader-harness");
  execFileSync(process.env.CXX ?? "c++", ["-std=c++17", "-O1", "-o", bin, HARNESS_SRC]);
}, 120_000);

describe("WavReader (firmware RIFF walk, host-compiled)", () => {
  const fixtures = [
    ...readdirSync(FIXTURE_AUDIO_DIR)
      .filter((f) => f.endsWith(".wav"))
      .map((f) => path.join(FIXTURE_AUDIO_DIR, f)),
    AFCONVERT_WAV,
  ];

  it("has committed fixture WAVs to chew on", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it("at least one fixture carries afconvert's FLLR padding chunk", () => {
    const withFllr = fixtures.filter((f) => readFileSync(f).includes("FLLR"));
    expect(withFllr.length).toBeGreaterThan(0);
  });

  it("parses every fixture and matches tools/lib/wav.ts durations", () => {
    for (const f of fixtures) {
      const buf = readFileSync(f);
      const res = runHarness(f);
      expect(res.ok, `${f}: ${JSON.stringify(res)}`).toBe(true);
      if (!res.ok) continue;
      // dataOffset must sit right after a "data" chunk header.
      expect(buf.toString("ascii", res.dataOffset - 8, res.dataOffset - 4)).toBe("data");
      const durationMs = Math.round((res.dataBytes / 2 / res.sampleRate) * 1000);
      expect(durationMs, f).toBe(wavDurationMs(buf));
    }
  });

  it("parses an encodeWav buffer exactly", () => {
    const buf = toneWav();
    const res = parseBuffer(buf);
    expect(res).toEqual({
      ok: true,
      sampleRate: 22050,
      dataOffset: 44,
      dataBytes: 22050, // half a second of 16-bit mono
    });
  });

  it("rejects garbage as not-riff", () => {
    expect(parseBuffer(Buffer.from("definitely not a riff file, sorry"))).toEqual({
      ok: false,
      error: "not-riff",
    });
  });

  it("rejects a buffer truncated inside the RIFF header", () => {
    expect(parseBuffer(toneWav().subarray(0, 6))).toEqual({ ok: false, error: "not-riff" });
  });

  it("rejects a buffer truncated inside the fmt chunk", () => {
    expect(parseBuffer(toneWav().subarray(0, 20))).toEqual({ ok: false, error: "bad-fmt" });
  });

  it("rejects a valid header with the chunk walk truncated before data", () => {
    // Header + complete fmt chunk, but the data chunk header is cut off.
    expect(parseBuffer(toneWav().subarray(0, 38))).toEqual({ ok: false, error: "no-data" });
  });

  it("rejects stereo as unsupported and reports the fmt it saw", () => {
    const buf = toneWav();
    buf.writeUInt16LE(2, 22); // channels = 2
    expect(parseBuffer(buf)).toEqual({ ok: false, error: "unsupported-format" });
  });

  it("rejects 8-bit as unsupported", () => {
    const buf = toneWav();
    buf.writeUInt16LE(8, 34); // bits per sample = 8
    expect(parseBuffer(buf)).toEqual({ ok: false, error: "unsupported-format" });
  });

  it("rejects data appearing before fmt", () => {
    const buf = Buffer.alloc(28);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(20, 4);
    buf.write("WAVE", 8);
    buf.write("data", 12);
    buf.writeUInt32LE(8, 16);
    expect(parseBuffer(buf)).toEqual({ ok: false, error: "data-before-fmt" });
  });
});
