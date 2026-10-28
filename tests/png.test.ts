import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { encodePng } from "../tools/lib/png";

describe("encodePng", () => {
  it("writes a PNG signature and an IHDR describing the image", () => {
    const png = encodePng(2, 3, new Uint8Array(2 * 3 * 3));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(2); // width
    expect(png.readUInt32BE(20)).toBe(3); // height
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(2); // color type: truecolor RGB
  });

  it("round-trips pixel data through the IDAT, one filter byte per scanline", () => {
    const rgb = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // 2x2
    const png = encodePng(2, 2, rgb);
    const idat = png.indexOf(Buffer.from("IDAT", "ascii"));
    const len = png.readUInt32BE(idat - 4);
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + len));
    expect([...raw]).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 7, 8, 9, 10, 11, 12]);
  });

  it("rejects a pixel buffer that doesn't match the dimensions", () => {
    expect(() => encodePng(2, 2, new Uint8Array(5))).toThrow(/expected 12 bytes/);
  });

  it("ends with an IEND chunk", () => {
    const png = encodePng(1, 1, new Uint8Array(3));
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
  });

  // An empty IEND chunk's CRC-32 is a fixed, well-known PNG constant. Checking
  // it pins the encoder's CRC against an external reference: a wrong CRC table
  // (which the structural/inflate tests above would not catch) fails here.
  it("writes the canonical IEND CRC (0xAE426082)", () => {
    const png = encodePng(1, 1, new Uint8Array(3));
    expect([...png.subarray(png.length - 4)]).toEqual([0xae, 0x42, 0x60, 0x82]);
  });

  // Recompute every chunk's CRC with an INDEPENDENT bitwise implementation (no
  // shared table with png.ts) and confirm it matches the bytes the encoder
  // wrote. Catches a wrong CRC table on real chunk data, not just IEND.
  it("writes a correct CRC for every chunk", () => {
    const refCrc = (buf: Buffer): number => {
      let c = 0xffffffff;
      for (const byte of buf) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const png = encodePng(2, 2, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    let pos = 8; // skip signature
    let chunks = 0;
    while (pos < png.length) {
      const len = png.readUInt32BE(pos);
      const body = png.subarray(pos + 4, pos + 8 + len); // type + data
      const stored = png.readUInt32BE(pos + 8 + len);
      expect(stored, png.subarray(pos + 4, pos + 8).toString("ascii")).toBe(refCrc(body));
      pos += 12 + len;
      chunks++;
    }
    expect(chunks).toBe(3); // IHDR, IDAT, IEND
  });

  it("is byte-deterministic across runs", () => {
    const rgb = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 255, 128]);
    expect(encodePng(2, 2, rgb).equals(encodePng(2, 2, rgb))).toBe(true);
  });
});
