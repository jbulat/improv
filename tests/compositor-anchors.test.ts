// The compositor's computed ink extents must match tools/lib/placement.ts's
// inkBox() exactly: the compositor is the on-device original, inkBox() is its
// hand-maintained TS mirror, and a back_prop anchors above whatever `top` the
// compositor reports.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildApp } from "../tools/build-app";
import { emitTroupeStubLua } from "../tools/gen-troupe-header";
import { loadActor, loadPalette } from "../tools/lib/sprites";
import { inkBox } from "../tools/lib/placement";

// Same stub pattern as tests/app-device-playback.test.ts and
// tests/build-app.test.ts: the viewer reads its art from the resident
// troupe, so a headless run needs the stub that stands in for it.
const stubDir = mkdtempSync(path.join(tmpdir(), "troupe-stub-"));
const troupeStubPath = path.join(stubDir, "troupe-stub.lua");
writeFileSync(troupeStubPath, emitTroupeStubLua());

describe("compositor ink anchors (headless)", () => {
  it("computes the base ink top for every actor, matching inkBox", () => {
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-compositor-anchors.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    const tops = Object.fromEntries([...out.matchAll(/TOP (\S+) (\S+)/g)].map((m) => [m[1], m[2]]));

    const palette = loadPalette("sprites/palette.json");
    // Every actor with authored art, not just a sample -- includes tuk and
    // miss_moon, whose ink starts at row 0.
    for (const id of ["ada", "bruno", "milo", "miss_moon", "pip", "rosa", "tuk"]) {
      expect(id in tops, `no TOP line for ${id}`).toBe(true);
      const expected = inkBox(loadActor(`sprites/actors/${id}`, palette).base).top;
      expect(Number(tops[id]), id).toBe(expected);
    }
  });

  it("draws back_prop behind the base, so the body occludes it", () => {
    // tests/lua/run-back-prop.lua injects a synthetic "testblock" back_prop
    // that straddles rosa's ink box, then diffs a painted-pixel map between
    // her bare render and the render with the prop. A naive rect-count delta
    // would also pass if the prop drew on top of the base, so the probe
    // checks actual pixel colors: every pixel the bare render inks must come
    // out identical (the base overdraws the prop), and a prop pixel outside
    // the ink box columns must still appear (proving the prop actually drew,
    // rather than never drawing at all).
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-back-prop.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(out).toContain("OUTSIDE_ABSENT_WHEN_BARE true"); // sanity: probe geometry is actually outside the silhouette
    expect(Number(/OCCLUSION_MISMATCHES (\d+)/.exec(out)![1])).toBe(0);
    expect(out).toContain("OUTSIDE_DRAWN true");
  });

  it("draws a front_prop over the base — and degrades to bare on unknown art or a missing hand", () => {
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-front-prop.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(out).toContain("UNDER_BODY_WHEN_BARE true");
    expect(out).toContain("BLADE_WINS true");
    expect(out).toContain("FORGIVING true");
  });
});
