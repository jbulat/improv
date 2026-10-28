import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadBundle } from "../tools/lib/bundle";
import { stagedAudioFiles } from "../tools/lib/staging";

const KNIGHT = "fixtures/knight-and-lonely-dragon";

describe("stagedAudioFiles", () => {
  it("lists every assets.audio entry, sorted by id, with flat basenames", () => {
    const bundle = loadBundle(KNIGHT);
    const files = stagedAudioFiles(bundle);
    expect(files).toHaveLength(bundle.perf.assets.audio.length);
    const ids = [...bundle.perf.assets.audio].sort((x, y) => x.id.localeCompare(y.id));
    files.forEach((f, i) => {
      expect(f.base).toBe(path.basename(ids[i].uri));
      expect(f.base).not.toContain("/");
      expect(f.src).toBe(path.join(bundle.dir, ids[i].uri));
    });
  });
});
