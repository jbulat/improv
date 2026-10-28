// 16-bit PCM mono WAV encode + RIFF duration parse. No dependencies.

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

interface RiffLayout {
  fmt: { audioFormat: number; rate: number; channels: number; bits: number };
  dataStart: number;
  dataLen: number;
}

// afconvert may insert chunks beyond fmt/data (FLLR padding), so walk them all.
function walkRiff(buf: Buffer): RiffLayout {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let offset = 12;
  let fmt: RiffLayout["fmt"] | null = null;
  let dataStart: number | null = null;
  let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(offset + 8),
        channels: buf.readUInt16LE(offset + 10),
        rate: buf.readUInt32LE(offset + 12),
        bits: buf.readUInt16LE(offset + 22),
      };
    }
    if (id === "data") {
      dataStart = offset + 8;
      dataLen = size;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || dataStart === null) throw new Error("WAV missing fmt/data chunk");
  return { fmt, dataStart, dataLen };
}

export interface WavFormat {
  /** `fmt` audioFormat: 1 is uncompressed PCM. */
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/**
 * The `fmt` chunk, read by walking the chunk list. This is the whole of what a
 * clip claims to be, and it is what tools/lib/delivery-format.ts checks against
 * the contract -- nothing here decides what the right values are.
 */
export function readWavFormat(buf: Buffer): WavFormat {
  const { fmt } = walkRiff(buf);
  return {
    audioFormat: fmt.audioFormat,
    channels: fmt.channels,
    sampleRate: fmt.rate,
    bitsPerSample: fmt.bits,
  };
}

export function wavDurationMs(buf: Buffer): number {
  const { fmt, dataLen } = walkRiff(buf);
  const bytesPerSecond = fmt.rate * fmt.channels * (fmt.bits / 8);
  return Math.round((dataLen / bytesPerSecond) * 1000);
}

export interface DecodedWav {
  samples: Float32Array; // mono, [-1, 1] (channels averaged if >1)
  sampleRate: number;
  channels: number;
}

/** Decode a 16-bit PCM WAV to mono float samples. Mirrors encodeWav's format. */
export function decodeWav(buf: Buffer): DecodedWav {
  const { fmt, dataStart, dataLen } = walkRiff(buf);
  if (fmt.bits !== 16) throw new Error(`only 16-bit PCM supported, got ${fmt.bits}-bit`);
  const { channels, rate } = fmt;
  const frames = Math.floor(dataLen / 2 / channels);
  const samples = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      acc += buf.readInt16LE(dataStart + (f * channels + c) * 2);
    }
    samples[f] = acc / channels / 32768;
  }
  return { samples, sampleRate: rate, channels };
}
