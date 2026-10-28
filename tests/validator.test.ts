import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validatePerformance } from "../tools/lib/validator";
import { basePerformance } from "../tools/lib/fixture-base";
import type { Troupe } from "../tools/lib/types";

const troupe: Troupe = JSON.parse(readFileSync("troupe/troupe.json", "utf8"));

describe("shape pass", () => {
  it("accepts the minimal valid performance", () => {
    const r = validatePerformance(basePerformance(), troupe);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects a performance missing its cast", () => {
    const p = basePerformance() as unknown as Record<string, unknown>;
    delete p.cast;
    const r = validatePerformance(p, troupe);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("SHAPE");
  });

  it("rejects a wrong schema_version", () => {
    const p = basePerformance() as unknown as { schema_version: number };
    p.schema_version = 1;
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("SHAPE");
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { INVALID_CASES } from "../tools/lib/invalid-cases";
import { encodeWav } from "../tools/lib/wav";

describe("semantic checks (mutation table)", () => {
  for (const c of INVALID_CASES) {
    it(`${c.name} trips ${c.code}`, () => {
      const p = basePerformance();
      c.mutate(p);
      const r = validatePerformance(p, troupe);
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => e.code)).toContain(c.code);
    });
  }

  it("rejects a default_expression the actor does not have", () => {
    const p = basePerformance();
    p.cast[1].default_expression = "giggling";
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("BAD_EXPRESSION");
  });

  it("rejects a default_device missing from stage.devices", () => {
    const p = basePerformance();
    p.stage.default_device = "d9";
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("UNKNOWN_DEVICE");
  });
});

describe("audio asset ids and uris", () => {
  const codes = (p: ReturnType<typeof basePerformance>, dir?: string) =>
    validatePerformance(p, troupe, { checkFilesDir: dir }).errors.map((e) => e.code);

  it("rejects two audio assets with the same id", () => {
    const p = basePerformance();
    p.assets.audio.push({ ...p.assets.audio[1] });
    expect(codes(p)).toContain("DUPLICATE_AUDIO_ID");
  });

  for (const uri of [
    "../aud_000.wav",
    "audio/../../aud_000.wav",
    "/etc/aud_000.wav",
    "audio\\aud_000.wav",
    "..",
  ]) {
    it(`rejects the bundle-relative uri ${JSON.stringify(uri)}`, () => {
      const p = basePerformance();
      p.assets.audio[0].uri = uri;
      expect(codes(p)).toContain("AUDIO_URI_OUTSIDE_BUNDLE");
    });
  }

  for (const uri of [
    "audio/aud_000.wav",
    "./audio/aud_000.wav",
    "audio/x/../aud_000.wav",
    "flash://stories/aud_000.wav",
    "https://example.com/aud_000.wav",
  ]) {
    it(`accepts the uri ${JSON.stringify(uri)}`, () => {
      const p = basePerformance();
      p.assets.audio[0].uri = uri;
      expect(codes(p)).not.toContain("AUDIO_URI_OUTSIDE_BUNDLE");
    });
  }

  it("does not read a file outside the bundle when checking files", () => {
    // A real WAV sits just outside the bundle, at the wrong length. Reading it
    // would add AUDIO_DURATION_MISMATCH; the uri check must stop that first.
    const root = mkdtempSync(path.join(os.tmpdir(), "uri-check-"));
    try {
      const bundle = path.join(root, "bundle");
      mkdirSync(bundle);
      writeFileSync(path.join(root, "outside.wav"), encodeWav(new Float32Array(16000), 16000));
      const p = basePerformance();
      p.assets.audio[0].uri = "../outside.wav";
      const found = codes(p, bundle);
      expect(found).toContain("AUDIO_URI_OUTSIDE_BUNDLE");
      expect(found).not.toContain("AUDIO_DURATION_MISMATCH");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("warnings", () => {
  it("warns on orphaned audio assets but stays valid", () => {
    const p = basePerformance();
    p.assets.audio.push({
      id: "aud_zzz",
      kind: "line",
      uri: "audio/aud_zzz.wav",
      format: "wav",
      duration_ms: 1000,
    });
    const r = validatePerformance(p, troupe);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("ORPHAN_AUDIO");
  });

  it("warns when a beat is shorter than its line clip", () => {
    const p = basePerformance();
    p.timeline[0].duration_ms = 500; // clip aud_000 is 2000ms
    const r = validatePerformance(p, troupe);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("DURATION_SHORT");
  });
});

describe("voice binding", () => {
  it("accepts a cast voice that matches the actor's signature voice", () => {
    const r = validatePerformance(basePerformance(), troupe);
    expect(r.errors.map((e) => e.code)).not.toContain("VOICE_NOT_SIGNATURE");
  });

  it("rejects an actor speaking with another actor's voice", () => {
    const p = basePerformance();
    p.cast[1].voice = "tts_low_rumble"; // cast[1] is milo, whose voice is tts_mid_earnest
    const r = validatePerformance(p, troupe);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("VOICE_NOT_SIGNATURE");
  });

  it("rejects Miss Moon speaking with anything but her host voice", () => {
    const p = basePerformance();
    p.cast[0].voice = "tts_mid_earnest";
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("VOICE_NOT_SIGNATURE");
  });

  it("does not fire VOICE_NOT_SIGNATURE for an unknown actor", () => {
    const p = basePerformance();
    p.cast[1].actor = "gerald";
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("UNKNOWN_ACTOR");
    expect(r.errors.map((e) => e.code)).not.toContain("VOICE_NOT_SIGNATURE");
  });

  it("every troupe actor's signature voice is in the voice catalog", () => {
    const ids = new Set(troupe.voices.map((v) => v.id));
    for (const a of troupe.actors) expect(ids, a.id).toContain(a.voice);
    expect(ids).toContain(troupe.mc.voice);
  });
});

describe("layer casting", () => {
  it("accepts a category fit: the crown fits any human", () => {
    const p = basePerformance();
    p.cast[1].layers = { headwear: "crown" }; // cast[1] is milo, a human
    const r = validatePerformance(p, troupe);
    expect(r.errors).toEqual([]);
  });

  it("accepts an actor-id fit: horns on tuk", () => {
    const p = basePerformance();
    p.cast[1].actor = "tuk";
    p.cast[1].voice = "tts_low_rumble";
    p.cast[1].layers = { headwear: "horns" };
    const r = validatePerformance(p, troupe);
    expect(r.errors).toEqual([]);
  });

  it("accepts the sword on a human", () => {
    const p = basePerformance();
    p.cast[1].layers = { front_prop: "sword" }; // cast[1] is milo, a human
    const r = validatePerformance(p, troupe);
    expect(r.errors).toEqual([]);
  });

  it("rejects the sword on an actor without hands", () => {
    const p = basePerformance();
    p.cast[1].actor = "pip";
    p.cast[1].voice = "tts_high_quick"; // pip's signature voice, so LAYER_MISFIT is the only error under test
    p.cast[1].layers = { front_prop: "sword" };
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("LAYER_MISFIT");
  });

  it("accepts explicit null slots — empty paper-doll slots are the Phase 1 shape", () => {
    const p = basePerformance();
    p.cast[1].layers = { back_prop: null, costume: null, headwear: null, front_prop: null };
    const r = validatePerformance(p, troupe);
    expect(r.errors).toEqual([]);
  });

  it("rejects a real layer id cast into the wrong slot", () => {
    const p = basePerformance();
    p.cast[1].layers = { costume: "crown" }; // crown exists, but as headwear
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("UNKNOWN_LAYER");
  });

  it("rejects Miss Moon wearing layers — she has no costume/prop slots", () => {
    const p = basePerformance();
    p.cast[0].layers = { headwear: "crown" };
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("LAYER_MISFIT");
  });

  it("does not fire LAYER_MISFIT for an unknown actor", () => {
    const p = basePerformance();
    p.cast[1].actor = "gerald";
    p.cast[1].layers = { headwear: "crown" };
    const r = validatePerformance(p, troupe);
    expect(r.errors.map((e) => e.code)).toContain("UNKNOWN_ACTOR");
    expect(r.errors.map((e) => e.code)).not.toContain("LAYER_MISFIT");
  });
});

describe("file checks (--check-files)", () => {
  function writeBundleAudio(dir: string, ms: number): void {
    mkdirSync(path.join(dir, "audio"), { recursive: true });
    const samples = new Float32Array(Math.floor((22050 * ms) / 1000));
    for (const a of basePerformance().assets.audio) {
      writeFileSync(path.join(dir, a.uri), encodeWav(samples, 22050));
    }
  }

  it("errors when a referenced audio file is missing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "st-checkfiles-"));
    const r = validatePerformance(basePerformance(), troupe, { checkFilesDir: dir });
    expect(r.errors.map((e) => e.code)).toContain("AUDIO_FILE_MISSING");
  });

  it("errors when file duration disagrees with the manifest", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "st-checkfiles-"));
    writeBundleAudio(dir, 1000); // manifest says 2000/1500/800
    const r = validatePerformance(basePerformance(), troupe, { checkFilesDir: dir });
    expect(r.errors.map((e) => e.code)).toContain("AUDIO_DURATION_MISMATCH");
  });

  it("passes when files exist and durations match", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "st-checkfiles-"));
    writeBundleAudio(dir, 1000);
    const p = basePerformance();
    for (const a of p.assets.audio) a.duration_ms = 1000;
    for (const b of p.timeline) b.duration_ms = 1300;
    const r = validatePerformance(p, troupe, { checkFilesDir: dir });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
