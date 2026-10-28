import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { openSession, stageBundle, deviceIdFor } from "../tools/lib/sim-session";
import { stagedAudioFiles } from "../tools/lib/staging";
import { loadBundle } from "../tools/lib/bundle";

const BUNDLE = "fixtures/knight-and-lonely-dragon";

function tmpRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "sim-session-"));
}

describe("stagedAudioFiles", () => {
  it("returns every declared audio asset, sorted by id", () => {
    const bundle = loadBundle(BUNDLE);
    const files = stagedAudioFiles(bundle);
    expect(files.length).toBe(bundle.perf.assets.audio.length);
    const bases = files.map((f) => f.base);
    expect(bases).toContain("aud_000.wav");
    expect(bases).toContain("sfx_chime.wav");
    expect([...bases]).toEqual(bases); // already in a stable order
  });

  it("flattens each asset uri to its basename, as the device path expects", () => {
    const files = stagedAudioFiles(loadBundle(BUNDLE));
    for (const f of files) {
      expect(f.base).not.toContain("/");
      expect(f.src.endsWith(f.base)).toBe(true);
      expect(path.isAbsolute(f.src) || f.src.startsWith(BUNDLE)).toBe(true);
    }
  });

  it("agrees with what pack:audio stages, so USB and OTA cannot drift", () => {
    // pack-audio.ts sorts assets.audio by id and uses path.basename(uri); this
    // helper is that rule, extracted. If the two ever disagree, a story plays
    // from flash but not over the air (or the reverse).
    const bundle = loadBundle(BUNDLE);
    const expected = [...bundle.perf.assets.audio]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map((a) => path.basename(a.uri));
    expect(stagedAudioFiles(bundle).map((f) => f.base)).toEqual(expected);
  });
});

describe("deviceIdFor", () => {
  it("is a stable sim- id derived from the session path", () => {
    const a = deviceIdFor("/tmp/one");
    expect(a).toMatch(/^sim-[0-9a-f]{8}$/);
    expect(deviceIdFor("/tmp/one")).toBe(a);
    expect(deviceIdFor("/tmp/two")).not.toBe(a);
  });

  it("ignores a trailing slash, so re-running the same sim keeps its id", () => {
    expect(deviceIdFor("/tmp/one/")).toBe(deviceIdFor("/tmp/one"));
  });
});

describe("openSession", () => {
  it("creates <root>/<deviceId>/stories and reports both paths", () => {
    const root = tmpRoot();
    const s = openSession(root);
    expect(s.deviceId).toMatch(/^sim-[0-9a-f]{8}$/);
    expect(s.dir).toBe(path.join(root, s.deviceId));
    expect(s.storiesDir).toBe(path.join(s.dir, "stories"));
    expect(existsSync(s.storiesDir)).toBe(true);
  });

  it("honours an explicit device id", () => {
    const root = tmpRoot();
    const s = openSession(root, "sim-abcd1234");
    expect(s.deviceId).toBe("sim-abcd1234");
    expect(s.dir).toBe(path.join(root, "sim-abcd1234"));
  });
});

describe("stageBundle", () => {
  it("links every asset the performance declares, named as the device expects", () => {
    const s = openSession(tmpRoot());
    const staged = stageBundle(s, BUNDLE);
    expect(staged.name).toBe("knight-and-lonely-dragon");
    expect(staged.audioRoot).toBe("stories/knight-and-lonely-dragon");
    expect(staged.storyDir).toBe(path.join(s.storiesDir, "knight-and-lonely-dragon"));

    const perf = JSON.parse(readFileSync(path.join(BUNDLE, "performance.json"), "utf8"));
    expect(staged.files.length).toBe(perf.assets.audio.length);
    const onDisk = readdirSync(staged.storyDir).sort();
    expect(onDisk).toEqual(staged.files.map((f) => f.name).sort());
    expect(onDisk).toContain("aud_000.wav");
    expect(onDisk).toContain("sfx_chime.wav");
  });

  it("stages symlinks, not copies, so fixture edits show up immediately", () => {
    const s = openSession(tmpRoot());
    const staged = stageBundle(s, BUNDLE);
    const first = path.join(staged.storyDir, staged.files[0].name);
    expect(lstatSync(first).isSymbolicLink()).toBe(true);
    expect(readFileSync(first).length).toBe(staged.files[0].bytes);
  });

  it("is idempotent — restaging replaces the tree cleanly", () => {
    const s = openSession(tmpRoot());
    stageBundle(s, BUNDLE);
    writeFileSync(path.join(s.storiesDir, "knight-and-lonely-dragon", "stale.wav"), "x");
    const staged = stageBundle(s, BUNDLE);
    expect(readdirSync(staged.storyDir)).not.toContain("stale.wav");
  });

  it("refuses a bundle whose performance.json fails validation, leaving no partial state", () => {
    // Unlike fixtures/invalid (a flat pile of case-study JSON with no
    // performance.json at all — that trips loadBundle's own throw, not this
    // one), this builds a real bundle shape: performance.json + an audio/
    // dir, so loadBundle succeeds and stageBundle's own validatePerformance
    // wiring is what has to catch the problem.
    const s = openSession(tmpRoot());
    const scratch = mkdtempSync(path.join(tmpdir(), "sim-session-invalid-"));
    cpSync(path.resolve("fixtures/invalid/bad-audio-ref.json"), path.join(scratch, "performance.json"));
    mkdirSync(path.join(scratch, "audio")); // present but empty: the referenced files are missing

    expect(() => stageBundle(s, scratch)).toThrow(/failed validation/);

    // A refused bundle must not leave a story directory, symlinks, or anything
    // else behind in the session tree.
    expect(readdirSync(s.storiesDir)).toEqual([]);
    expect(existsSync(path.join(s.storiesDir, path.basename(scratch)))).toBe(false);
  });

  it("refuses a directory with no performance.json", () => {
    const s = openSession(tmpRoot());
    expect(() => stageBundle(s, tmpRoot())).toThrow(/performance\.json/);
  });

  it('does not wipe a sibling bundle when bundleDir resolves to a bare name like "."', () => {
    // `--bundle .` is the natural thing to run from inside a bundle
    // directory. If bundle.name were the raw path.basename(bundleDir), it
    // would be ".", storyDir would be session.storiesDir, and restaging would
    // wipe the whole stories/ tree, sibling bundles included.
    const s = openSession(tmpRoot());
    stageBundle(s, BUNDLE);

    const scratch = mkdtempSync(path.join(tmpdir(), "sim-session-dotbundle-"));
    cpSync(path.resolve(BUNDLE), scratch, { recursive: true });

    const cwd = process.cwd();
    process.chdir(scratch);
    try {
      const staged = stageBundle(s, ".");
      expect(staged.name).not.toBe(".");
      expect(staged.storyDir).not.toBe(s.storiesDir);
      expect(staged.audioRoot).not.toBe("stories/.");
    } finally {
      process.chdir(cwd);
    }

    // The sibling bundle staged first is untouched.
    const siblingDir = path.join(s.storiesDir, "knight-and-lonely-dragon");
    expect(existsSync(siblingDir)).toBe(true);
    expect(readdirSync(siblingDir)).toContain("aud_000.wav");
  });
});
