import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { wavDurationMs } from "../tools/lib/wav";
import { bundleDirs, loadBundle } from "../tools/lib/bundle";

const dirs = bundleDirs();

describe("generated sfx", () => {
  it("discovers at least one bundle", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  for (const dir of dirs) {
    const b = loadBundle(dir);
    const sfx = b.perf.assets.audio.filter((a) => a.kind === "sfx");

    it(`${b.name} ships at least one sfx`, () => {
      expect(sfx.length).toBeGreaterThan(0);
    });

    for (const a of sfx) {
      it(`${b.name}/${a.id}.wav exists and is a plausible clip`, () => {
        const ms = wavDurationMs(readFileSync(path.join(b.dir, a.uri)));
        expect(ms).toBeGreaterThan(200);
        expect(ms).toBeLessThan(3000);
      });
    }
  }
});
