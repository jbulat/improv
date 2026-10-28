import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assetPath, loadBundle, bundleDirs } from "../tools/lib/bundle";
import { stagedAudioFiles } from "../tools/lib/staging";
import { basePerformance } from "../tools/lib/fixture-base";

describe("bundleDirs", () => {
  it("discovers story bundles and never the invalid-fixture dir", () => {
    const dirs = bundleDirs();
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs).toContain("fixtures/knight-and-lonely-dragon");
    expect(dirs.some((d) => d.includes("invalid"))).toBe(false);
  });

  it("is sorted, so builds and test ordering are deterministic", () => {
    expect(bundleDirs()).toEqual([...bundleDirs()].sort());
  });

  // Derives the expectation from disk rather than a literal roster, so a new
  // story does not turn `npm test` red on a bookkeeping assertion. It asserts
  // the actual rule: every fixtures/ dir with a performance.json, never
  // `invalid`.
  it("discovers every fixtures/ dir holding a performance.json, and nothing else", () => {
    const onDisk = readdirSync("fixtures", { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "invalid")
      .filter((e) => existsSync(path.join("fixtures", e.name, "performance.json")))
      .map((e) => `fixtures/${e.name}`)
      .sort();
    expect(onDisk.length).toBeGreaterThan(0);
    expect(bundleDirs()).toEqual(onDisk);
  });
});

describe("loadBundle", () => {
  it("resolves a bundle's paths and parses its performance", () => {
    const b = loadBundle("fixtures/knight-and-lonely-dragon");
    expect(b.name).toBe("knight-and-lonely-dragon");
    expect(b.audioDir).toBe("fixtures/knight-and-lonely-dragon/audio");
    expect(b.perf.id).toBe("perf_knight_lonely_dragon");
  });

  it("loads spoken overrides when present", () => {
    expect(loadBundle("fixtures/knight-and-lonely-dragon").spokenOverrides).toEqual({
      aud_013: "Ho ho ho hooo!",
    });
  });

  it("defaults spoken overrides to empty when the file is absent", () => {
    expect(loadBundle("fixtures/a-dog-called-bear").spokenOverrides).toEqual({});
  });

  it("throws a useful error for a directory with no performance.json", () => {
    expect(() => loadBundle("tools")).toThrow(/no performance\.json/);
  });
});

describe("assetPath", () => {
  it("resolves a uri inside the bundle", () => {
    expect(assetPath("fixtures/x", "audio/aud_000.wav")).toBe(path.join("fixtures/x", "audio/aud_000.wav"));
  });

  for (const uri of ["../aud_000.wav", "audio/../../aud_000.wav", "/tmp/aud_000.wav", "audio\\aud_000.wav"]) {
    it(`refuses ${JSON.stringify(uri)}`, () => {
      expect(() => assetPath("fixtures/x", uri)).toThrow(/not a path inside/);
    });
  }
});

describe("tools that read or write bundle audio refuse a uri outside the bundle", () => {
  function hostileBundle(): { root: string; dir: string } {
    const root = mkdtempSync(path.join(os.tmpdir(), "hostile-bundle-"));
    const dir = path.join(root, "story");
    mkdirSync(dir);
    const perf = basePerformance();
    perf.assets.audio[0].uri = "../escaped.wav";
    writeFileSync(path.join(dir, "performance.json"), JSON.stringify(perf));
    return { root, dir };
  }

  it("stagedAudioFiles throws instead of naming a file outside the bundle", () => {
    const { root, dir } = hostileBundle();
    try {
      expect(() => stagedAudioFiles(loadBundle(dir))).toThrow(/not a path inside/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
