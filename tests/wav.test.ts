import { describe, it, expect } from "vitest";
import { encodeWav, wavDurationMs, decodeWav } from "../tools/lib/wav";

/**
 * A WAV shaped like afconvert's: an FLLR padding chunk sitting between fmt and
 * data. The firmware's WavReader has to walk past it, and tests/wav-reader.test.ts
 * guards that the fixture corpus still contains such a file.
 */
function wavWithFllrChunk(samples: Float32Array, rate: number): Buffer {
  const plain = encodeWav(samples, rate);
  const data = plain.subarray(44);
  const fllrSize = 16;
  const fllr = Buffer.alloc(8 + fllrSize);
  fllr.write("FLLR", 0);
  fllr.writeUInt32LE(fllrSize, 4);

  const head = Buffer.from(plain.subarray(0, 36)); // RIFF..fmt chunk
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0);
  dataHeader.writeUInt32LE(data.length, 4);
  const out = Buffer.concat([head, fllr, dataHeader, data]);
  out.writeUInt32LE(out.length - 8, 4); // fix RIFF size
  return out;
}

describe("wav helpers", () => {
  it("round-trips duration exactly", () => {
    const rate = 22050;
    const samples = new Float32Array(rate); // exactly 1 second
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5;
    }
    expect(wavDurationMs(encodeWav(samples, rate))).toBe(1000);
  });

  it("handles a half-second buffer", () => {
    expect(wavDurationMs(encodeWav(new Float32Array(11025), 22050))).toBe(500);
  });

  it("rejects non-wav data", () => {
    expect(() => wavDurationMs(Buffer.from("definitely not a riff file, sorry"))).toThrow();
  });

  it("decodeWav round-trips samples within 16-bit quantization", () => {
    const rate = 22050;
    const samples = new Float32Array(64);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5;
    }
    const decoded = decodeWav(encodeWav(samples, rate));
    expect(decoded.sampleRate).toBe(rate);
    expect(decoded.channels).toBe(1);
    expect(decoded.samples).toHaveLength(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect(Math.abs(decoded.samples[i] - samples[i])).toBeLessThan(1 / 32000);
    }
  });
});

describe("a WAV with a padding chunk before data", () => {
  const rate = 16000;
  const samples = new Float32Array(512).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.2);

  it("decodes to the same samples and duration as the plain file", () => {
    const padded = wavWithFllrChunk(samples, rate);
    expect(padded.includes("FLLR")).toBe(true);
    expect(wavDurationMs(padded)).toBe(wavDurationMs(encodeWav(samples, rate)));
    const decoded = decodeWav(padded).samples;
    for (let i = 0; i < samples.length; i++) {
      expect(Math.abs(decoded[i] - samples[i])).toBeLessThan(1 / 32000);
    }
  });
});
