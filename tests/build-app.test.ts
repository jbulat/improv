import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { buildApp, buildAppSource, checkArtCoverage } from "../tools/build-app";
import { loadActor, loadPalette, type LayerArt } from "../tools/lib/sprites";
import { basePerformance } from "../tools/lib/fixture-base";
import type { Performance, LayerSlot } from "../tools/lib/types";
import { bundleDirs } from "../tools/lib/bundle";
import { emitTroupeStubLua, loadAllActors } from "../tools/gen-troupe-header";
import { troupeArtFingerprint } from "../tools/gen-sprite-data";

// The viewer reads its art from the resident troupe, so every headless run of
// it needs the same stub the device playback harness uses — see
// tests/app-device-playback.test.ts, which wires it identically. The stubs
// live in a mkdtemp dir so concurrent runs on one machine can't clobber each
// other's copies mid-read.
const stubDir = mkdtempSync(path.join(tmpdir(), "troupe-stub-"));
const troupeStubPath = path.join(stubDir, "troupe-stub.lua");
writeFileSync(troupeStubPath, emitTroupeStubLua());

/** A throwaway copy of the knight bundle with `mutate` applied to its cast. */
function tempBundleWithLayer(layers: Record<string, string | null>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "build-app-"));
  cpSync("fixtures/knight-and-lonely-dragon", dir, { recursive: true });
  const perfPath = path.join(dir, "performance.json");
  const perf = JSON.parse(readFileSync(perfPath, "utf8"));
  perf.cast.find((c: { character_id: string }) => c.character_id === "dragon").layers = layers;
  writeFileSync(perfPath, JSON.stringify(perf, null, 2));
  return dir;
}

describe("buildApp viewer", () => {
  it("builds the viewer app and passes lua syntax check", () => {
    const { outPath, bytes } = buildApp("viewer");
    expect(outPath).toMatch(/viewer\.lua$/);
    expect(bytes).toBeGreaterThan(0);
  });

  it("is byte-deterministic", () => {
    const a = readFileSync(buildApp("viewer").outPath, "utf8");
    const b = readFileSync(buildApp("viewer").outPath, "utf8");
    expect(a).toBe(b);
  });

  it("runs headlessly: draws and cycles without error", () => {
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-viewer.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(Number(/FILL_RECTS (\d+)/.exec(out)![1])).toBeGreaterThan(200);
    expect(Number(/FLIPS (\d+)/.exec(out)![1])).toBe(7); // init + 5 ticks + 1 post-button tick
  });

  it("committed viewer matches current sources", () => {
    const { source, outPath } = buildAppSource("viewer");
    expect(readFileSync(outPath, "utf8")).toBe(source);
  });

  // The prelude's failure contract (see emitTroupePrelude) holds for the
  // viewer too: on an art failure S.art_error is set and the entry renders it
  // and goes inert, instead of crashing in init_sprites on a nil S.sprites.
  // The local sim can't hit this (its stub regenerates from current sources
  // every start), but on hardware it is the viewer's likeliest failure: its
  // job is to show art the flashed firmware may not have yet.
  it("renders S.art_error and goes inert on an art fingerprint mismatch", () => {
    const { outPath } = buildApp("viewer");
    const stub = path.join(stubDir, "troupe-stub-wrong.lua");
    writeFileSync(stub, emitTroupeStubLua("00000000"));
    const out = execFileSync("lua", ["tests/lua/run-art-error.lua", outPath, stub], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    // The panel wraps at 11 chars; joining the drawn lines with spaces
    // restores the message, same as tests/app-device-playback.test.ts.
    const texts = /^TEXTS (.*)$/m.exec(out)![1].split("|").join(" ");
    expect(texts).toContain("Art set mismatch.");
    expect(out).toContain("SURVIVED true");
  });

  it("renders S.art_error and goes inert when troupe is absent", () => {
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-art-error.lua", outPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    const texts = /^TEXTS (.*)$/m.exec(out)![1].split("|").join(" ");
    expect(texts).toContain("This story needs newer");
    expect(out).toContain("SURVIVED true");
  });
});

describe("buildApp player", () => {
  it("builds, validates the fixture, passes lua syntax check, is deterministic", () => {
    const first = buildApp("player", "fixtures/knight-and-lonely-dragon");
    expect(first.outPath).toMatch(/knight-and-lonely-dragon\.device\.lua$/);
    const a = readFileSync(first.outPath, "utf8");
    const b = readFileSync(buildApp("player", "fixtures/knight-and-lonely-dragon").outPath, "utf8");
    expect(a).toBe(b);
  });

  it("requires a bundle", () => {
    expect(() => buildApp("player")).toThrow(/requires a bundle/);
  });

  it("installs only the cast's actors, not the whole troupe", () => {
    const out = readFileSync(buildApp("player", "fixtures/knight-and-lonely-dragon").outPath, "utf8");
    expect(out).toContain('pcall(troupe.install, S, { "milo", "miss_moon", "rosa", "tuk" })');
    expect(out).not.toContain('"bruno"');
  });

  // Every committed build/<bundle>.device.lua is a generated artifact, and a
  // stale one is dangerous: an app carrying an outdated want_art fingerprint
  // pushes fine and then shows "Art set mismatch." on hardware.
  //
  // These assert the committed bytes are what current sources produce. They
  // use buildAppSource (pure) rather than buildApp, which rewrites the
  // artifact in place and would turn staleness into a dirty tree instead of
  // a failing test. Same pattern as the committed-header check in
  // tests/gen-troupe-header.test.ts.
  //
  // Failure means the artifact is out of date, not that the build is broken:
  // run `npm run build:app -- --bundle <dir>` and commit the result.
  for (const dir of bundleDirs()) {
    it(`committed device app for ${dir} matches current sources`, () => {
      const { source, outPath } = buildAppSource("player", dir);
      expect(readFileSync(outPath, "utf8")).toBe(source);
    });
  }

  // An author who typos a layer id should get the validator's UNKNOWN_LAYER
  // message, not a raw ENOENT from the art loader -- which means validation
  // must run before any layer art is loaded off disk.
  it("reports an unknown layer id as a validation error, not a missing-file crash", () => {
    const dir = tempBundleWithLayer({ headwear: "propeller_beanie" });
    expect(() => buildApp("player", dir)).toThrow(/failed validation/);
    expect(() => buildApp("player", dir)).toThrow(/UNKNOWN_LAYER/);
    expect(() => buildApp("player", dir)).not.toThrow(/ENOENT/);
  });

  it("reports a misfit layer as a validation error", () => {
    // horns fit tuk; the dragon is played by tuk, so cast horns on a human
    // role instead -- milo, the knight -- to trip LAYER_MISFIT via the build.
    const dir = mkdtempSync(path.join(tmpdir(), "build-app-"));
    cpSync("fixtures/knight-and-lonely-dragon", dir, { recursive: true });
    const perfPath = path.join(dir, "performance.json");
    const perf = JSON.parse(readFileSync(perfPath, "utf8"));
    perf.cast.find((c: { character_id: string }) => c.character_id === "knight").layers = {
      headwear: "horns",
    };
    writeFileSync(perfPath, JSON.stringify(perf, null, 2));
    expect(() => buildApp("player", dir)).toThrow(/failed validation/);
    expect(() => buildApp("player", dir)).toThrow(/LAYER_MISFIT/);
  });

  // Hand anchors are app-delivered (they must stay out of the firmware art
  // fingerprint -- see ActorSprites.hand), and only a bundle that bakes a
  // front_prop needs them: the one slot that reads S.hand.
  it("emits S.hand for a bundle wearing a front_prop, for every cast hand", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "build-app-"));
    cpSync("fixtures/knight-and-lonely-dragon", dir, { recursive: true });
    const perfPath = path.join(dir, "performance.json");
    const perf = JSON.parse(readFileSync(perfPath, "utf8"));
    perf.cast.find((c: { character_id: string }) => c.character_id === "knight").layers = {
      front_prop: "sword",
    };
    writeFileSync(perfPath, JSON.stringify(perf, null, 2));
    const { source } = buildAppSource("player", dir);
    // The cast's anchored actors: milo (the knight), rosa (the princess) and
    // tuk, whose anchor is his muzzle rather than a fist -- it is what lets
    // the dragon breathe `fire`, and it ships for the whole cast whether or
    // not this bundle uses it. miss_moon has none and must not appear.
    expect(source).toContain(
      "S.hand = { milo = { x = 21, y = 23 }, rosa = { x = 22, y = 26 }, tuk = { x = 14, y = 13 } }",
    );
  });

  // The test above covers the cast-level path. wornKeys in build-app.ts is
  // collected from the cast and the timeline, so this covers a beat-level
  // reveal ("introduced bare, then puts the item on"). The cast-level sword
  // is stripped, so the beat override is the only source of front_prop: if it
  // were removed, no layer would bake a front_prop and this would fail.
  it("emits S.hand for a front_prop worn only as a beat-level reveal", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "build-app-"));
    cpSync("fixtures/knight-and-lonely-dragon", dir, { recursive: true });
    const perfPath = path.join(dir, "performance.json");
    const perf = JSON.parse(readFileSync(perfPath, "utf8"));
    perf.cast.find((c: { character_id: string }) => c.character_id === "knight").layers = {};
    perf.timeline.find((b: { text: string }) => b.text === "Stand back, dragon!").layers = {
      front_prop: "sword",
    };
    writeFileSync(perfPath, JSON.stringify(perf, null, 2));
    const { source } = buildAppSource("player", dir);
    // Same actors as the cast-level test: milo (the knight) and rosa (the
    // princess) and tuk (muzzle-anchored) all carry anchors, so all three
    // appear regardless of which one actually draws the sword.
    expect(source).toContain(
      "S.hand = { milo = { x = 21, y = 23 }, rosa = { x = 22, y = 26 }, tuk = { x = 14, y = 13 } }",
    );
  });

  it("emits no S.hand when nothing held is baked", () => {
    const { source } = buildAppSource("player", "fixtures/a-dog-called-bear");
    // Checked against the table assignment, not the bare "S.hand" substring:
    // compositor.lua (bundled into every build) already references S.hand in
    // its own code and comments, so a bare-substring check would always fail.
    expect(source).not.toContain("S.hand = {");
  });

  it("bundles audio.lua and names the output .device.lua", () => {
    const { outPath } = buildApp("player", "fixtures/knight-and-lonely-dragon");
    expect(outPath).toMatch(/knight-and-lonely-dragon\.device\.lua$/);
    const src = readFileSync(outPath, "utf8");
    // Checked by a symbol the chunk defines, not by its `-- ==== src/... ====`
    // banner: the build strips comments, so only code shows that a chunk was
    // bundled. PRELOAD_PER_TICK is defined in audio.lua and nowhere else.
    expect(src).toContain("PRELOAD_PER_TICK");
  });
});

describe("portrait placement (via built viewer bundle)", () => {
  it("grounds every actor on the shared baseline; miss_moon hangs in the sky", () => {
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-grounding.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    const bottoms = Object.fromEntries(
      [...out.matchAll(/BOTTOM (\S+) (\d+)/g)].map((m) => [m[1], Number(m[2])]),
    );
    // Feet on the line: content-bottom == BASELINE_Y for all six actors,
    // including pip, whose art stops 10 grid rows early (32x32 grid, ink
    // through row 22) and must be pushed down to compensate.
    for (const id of ["ada", "bruno", "milo", "pip", "rosa", "tuk"]) {
      expect(bottoms[id], id).toBe(236);
    }
    // miss_moon: sprite top at MOON_Y=8, ink through grid row 30 -> 8 + 30*4.
    expect(bottoms.miss_moon).toBe(128);
    expect(out).toContain("BASELINE 236");
  });

  it("scales per actor and centers the ink box fully on-screen", () => {
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-grounding.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    const spans = Object.fromEntries(
      [...out.matchAll(/SPAN (\S+) (-?\d+) (-?\d+)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]),
    );
    // Rendered ink widths: grid ink-width x per-actor scale (6x
    // humans+pip+tuk, 4x miss_moon).
    const widths: Record<string, number> = {
      ada: 120,
      bruno: 132,
      milo: 96,
      rosa: 120,
      pip: 84,
      tuk: 132,
      miss_moon: 112,
    };
    for (const [id, w] of Object.entries(widths)) {
      const [min, max] = spans[id];
      expect(max - min, `${id} width`).toBe(w);
      expect(min, `${id} left edge`).toBeGreaterThanOrEqual(0);
      expect(max, `${id} right edge`).toBeLessThanOrEqual(135);
      // Centered: left and right margins within a pixel of each other.
      expect(Math.abs(min - (135 - max)), `${id} centering`).toBeLessThanOrEqual(1);
    }
  });

  it("draws double-resolution overlays at half the actor scale", () => {
    // A synthetic actor whose overlay grid is twice its face box, so the
    // check does not depend on any one actor's art: base rows draw 6px tall
    // and overlay rows 3px (6 // 2).
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-hires.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(out).toContain("HIRES_OK true");
  });

  it("draws double-resolution layer art at half the actor scale", () => {
    const { outPath } = buildApp("viewer");
    const out = execFileSync("lua", ["tests/lua/run-layer-density.lua", outPath, troupeStubPath], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    for (const flag of [
      "HI_STEP",
      "HI_TOP",
      "HI_LEFT",
      "NUDGE_X",
      "NUDGE_Y",
      "LO_STEP",
      "LO_TOP",
      "BARE_DEFAULTS_TO_1",
      "HEADWEAR_X",
      "HEADWEAR_Y",
    ]) {
      expect(out, flag).toContain(`${flag} true`);
    }
  });
});

describe("player app: resident troupe art", () => {
  const { outPath } = buildApp("player", "fixtures/meet-the-troupe");
  const out = readFileSync(outPath, "utf8");

  it("inlines no actor art", () => {
    expect(out).not.toContain("S.sprites = {");
    expect(out).not.toContain("S.palette = {");
    expect(out).not.toContain("base = [[");
  });

  it("installs exactly the cast against the firmware fingerprint", () => {
    const { actors, palette } = loadAllActors();
    expect(out).toContain(`local want_art = "${troupeArtFingerprint(actors, palette)}"`);
    expect(out).toContain(
      'pcall(troupe.install, S, { "ada", "bruno", "milo", "miss_moon", "pip", "rosa", "tuk" })',
    );
  });

  it("still carries layer art and the performance", () => {
    expect(out).toContain("S.layer_art = {");
    expect(out).toContain("S.performance");
  });

  // Growth tripwires, not the hardware limit: on the device, courier ran a
  // 50,035-byte app and dropped a 68,748-byte one with NoMemory. The
  // catalogue demo wears every prop the troupe owns, so it is the largest app
  // by design and has its own bound; the fleet bound covers every other
  // story, including new ones that story-create writes into fixtures/. Each
  // bound sits about one large layer (`wings` is 1,908 B) above its current
  // maximum (demo about 26.6 KB, fleet about 19.2 KB): an ordinary new prop
  // fits, and a second one or real engine growth trips the test on purpose.
  const DEMO_BUNDLE = "fixtures/meet-the-troupe";

  it("keeps the catalogue demo under its own courier ceiling", () => {
    // Named, not derived: if the demo is renamed this must fail loudly rather
    // than quietly exempt nothing and fold the demo back into the fleet bound.
    expect(bundleDirs(), "the catalogue demo moved or was renamed").toContain(DEMO_BUNDLE);
    const built = buildApp("player", DEMO_BUNDLE);
    expect(built.bytes, `${DEMO_BUNDLE} (${built.bytes} bytes) is the catalogue demo`).toBeLessThan(29000);
  });

  it("keeps every shipping story comfortably under the courier ceiling", () => {
    let maxBytes = 0;
    let maxBundle = "";
    for (const dir of bundleDirs()) {
      if (dir === DEMO_BUNDLE) continue;
      const built = buildApp("player", dir);
      if (built.bytes > maxBytes) {
        maxBytes = built.bytes;
        maxBundle = dir;
      }
    }
    expect(maxBundle, "the fleet is only the demo -- this bound measured nothing").not.toBe("");
    expect(maxBytes, `${maxBundle} (${maxBytes} bytes) is the fleet maximum`).toBeLessThan(21000);
  });
});

// The 32x32 authoring cell is not the 135px screen: at 6x a full cell is 192px
// wide and placement centres on the ink box, so art can sit squarely inside the
// cell and still be clipped on device. The build rejects such art.
describe("layer art must land on screen, not merely inside the cell", () => {
  const palette = loadPalette("sprites/palette.json");

  /** A cast of one: `actor` wearing `layer` in the given slot. */
  function perfWearing(actor: string, slot: LayerSlot = "headwear"): Performance {
    const perf = basePerformance();
    perf.cast = [
      {
        character_id: "solo",
        display_name: "Solo",
        actor,
        voice: "tts_bright_young",
        default_expression: "neutral",
        layers: { [slot]: "wide" },
      },
    ];
    perf.timeline = [
      {
        index: 0,
        character_id: "solo",
        expression: "neutral",
        text: "hi",
        line_audio: null,
        sfx: [],
        duration_ms: 1000,
        animation: "none",
      },
    ];
    return perf;
  }

  /** `w`-wide solid art, anchored by the usual headwear rule. */
  const wideLayer = (w: number): LayerArt => ({
    id: "wide",
    slot: "headwear",
    grid: ["r".repeat(w)],
    w,
    h: 1,
    dx: 0,
    dy: 0,
    density: 1,
    bleedX: 0,
  });

  it("rejects art that fits the cell but renders off the screen edges", () => {
    const rosa = loadActor("sprites/actors/rosa", palette);
    // 26 wide anchors at cell x 3 on rosa -- inside the cell, 5px off screen.
    expect(() => checkArtCoverage(perfWearing("rosa"), [rosa], [wideLayer(26)])).toThrow(/off the left/);
  });

  it("accepts the same art once narrowed to rosa's on-screen columns", () => {
    const rosa = loadActor("sprites/actors/rosa", palette);
    expect(() => checkArtCoverage(perfWearing("rosa"), [rosa], [wideLayer(22)])).not.toThrow();
  });

  it("accepts art above the cell when the screen has room for it", () => {
    const rosa = loadActor("sprites/actors/rosa", palette);
    // A back_prop 12 rows tall on rosa anchors at y = inkTop(8) - 12 = -4:
    // four rows above the cell, and comfortably on screen.
    const wing: LayerArt = {
      id: "wide",
      slot: "back_prop",
      grid: Array(12).fill("r".repeat(18)),
      w: 18,
      h: 12,
      dx: 0,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    expect(() => checkArtCoverage(perfWearing("rosa", "back_prop"), [rosa], [wing])).not.toThrow();
  });

  it("omits the bleed_x clause when the violation is purely vertical, even with a budget declared", () => {
    const rosa = loadActor("sprites/actors/rosa", palette);
    // Pushed far above the cell by dy, with a horizontal bleed_x budget that
    // has nothing to do with this overflow -- the message must not imply it does.
    const tallWing: LayerArt = {
      id: "wide",
      slot: "back_prop",
      grid: Array(12).fill("r".repeat(18)),
      w: 18,
      h: 12,
      dx: 0,
      dy: -200,
      density: 1,
      bleedX: 12,
    };
    expect(() => checkArtCoverage(perfWearing("rosa", "back_prop"), [rosa], [tallWing])).toThrow(
      /off the top/,
    );
    try {
      checkArtCoverage(perfWearing("rosa", "back_prop"), [rosa], [tallWing]);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toMatch(/bleed_x/);
    }
  });
});
