import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { emitTroupeHeader, emitTroupeStubLua, loadAllActors, HEADER_PATH } from "../tools/gen-troupe-header";
import { emitSpritesLua, troupeArtFingerprint } from "../tools/gen-sprite-data";

const ROOT = new URL("..", import.meta.url).pathname;

describe("TroupeArtData.h", () => {
  const { actors, palette } = loadAllActors();

  it("committed header is current — run `npm run gen:troupe` if this fails", () => {
    expect(readFileSync(path.join(ROOT, HEADER_PATH), "utf8")).toBe(emitTroupeHeader());
  });

  it("carries every actor with authored art, plus the fingerprint", () => {
    const header = emitTroupeHeader();
    for (const a of actors) expect(header).toContain(`{"${a.id}", R"LUA(`);
    expect(header).toContain(`kFingerprintHex = "${troupeArtFingerprint(actors, palette)}"`);
  });

  it("stub install reproduces the sim emitter's tables exactly", () => {
    const stubPath = path.join(tmpdir(), "troupe-stub.lua");
    const simPath = path.join(tmpdir(), "troupe-sim.lua");
    writeFileSync(stubPath, emitTroupeStubLua());
    writeFileSync(simPath, "S = {}\n" + emitSpritesLua(actors, palette));
    const out = execFileSync(
      "lua",
      ["tests/lua/deep-compare-install.lua", simPath, stubPath, ...actors.map((a) => a.id)],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(out.trim()).toBe("EQUAL");
  });

  it("stub fingerprint override is honored (mismatch harnesses rely on it)", () => {
    expect(emitTroupeStubLua("00000000")).toContain('return "00000000"');
  });
});
