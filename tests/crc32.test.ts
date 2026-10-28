import { describe, it, expect } from "vitest";
import { crc32, crc32Hex } from "../tools/lib/crc32";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the standard check value for '123456789'", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("matches zlib for a longer ASCII string", () => {
    // python3 -c "import zlib; print(hex(zlib.crc32(b'The quick brown fox jumps over the lazy dog')))"
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("crc32Hex pads to 8 lowercase hex chars", () => {
    expect(crc32Hex(bytes("123456789"))).toBe("cbf43926");
    expect(crc32Hex(new Uint8Array(0))).toBe("00000000");
  });
});
