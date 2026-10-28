import { mkdtempSync, readdirSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { packAudio } from "../tools/pack-audio";

const KNIGHT = "fixtures/knight-and-lonely-dragon";

describe("packAudio", () => {
  it("stages exactly the manifest's wavs under stories/<bundle>", () => {
    const out = mkdtempSync(path.join(tmpdir(), "pack-"));
    const { files, bytes } = packAudio([KNIGHT], out);
    expect(files).toBe(19);
    // ~1.27 MB at 16 kHz. The floor guards against staging empty or truncated
    // clips, so it tracks the real figure rather than leading it.
    expect(bytes).toBeGreaterThan(1_200_000);
    const staged = readdirSync(path.join(out, "stories/knight-and-lonely-dragon")).sort();
    expect(staged).toHaveLength(19);
    expect(staged).toContain("aud_000.wav");
    expect(staged).toContain("sfx_chime.wav");
  });

  it("wipes stale files from a previous staging", () => {
    const out = mkdtempSync(path.join(tmpdir(), "pack-"));
    const staleDir = path.join(out, "stories/knight-and-lonely-dragon");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(path.join(staleDir, "stale.wav"), "x");
    packAudio([KNIGHT], out);
    expect(existsSync(path.join(staleDir, "stale.wav"))).toBe(false);
  });

  it("refuses to stage when the manifest references a WAV that isn't on disk", () => {
    const out = mkdtempSync(path.join(tmpdir(), "pack-"));
    const bundleDir = mkdtempSync(path.join(tmpdir(), "pack-bundle-"));
    cpSync(KNIGHT, bundleDir, { recursive: true });
    rmSync(path.join(bundleDir, "audio/aud_000.wav"));
    expect(() => packAudio([bundleDir], out)).toThrow(/AUDIO_FILE_MISSING/);
  });
});
