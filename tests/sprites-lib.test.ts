import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  layerAnchor,
  loadLayerArt,
  loadPalette,
  parseGrid,
  loadActor,
  CELL,
  type LayerArt,
} from "../tools/lib/sprites";
import { loadTroupe } from "../tools/lib/troupe";
import { screenOverflow, describeViolation, overflowViolation, actorScale } from "../tools/lib/placement";

const PALETTE = loadPalette(new URL("../sprites/palette.json", import.meta.url).pathname);

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "sprites-"));
}

describe("loadPalette", () => {
  it("loads the project palette with rgb components", () => {
    expect(Object.keys(PALETTE).length).toBe(16);
    expect(PALETTE.k).toEqual({ r: 26, g: 28, b: 44 });
    expect(PALETTE.w).toEqual({ r: 244, g: 244, b: 244 });
  });

  it("rejects a multi-char key", () => {
    const dir = tmp();
    const file = path.join(dir, "palette.json");
    writeFileSync(file, JSON.stringify({ kk: "#000000" }));
    expect(() => loadPalette(file)).toThrow(/single char/);
  });

  it("rejects '.' as a key and bad hex", () => {
    const dir = tmp();
    const dot = path.join(dir, "dot.json");
    writeFileSync(dot, JSON.stringify({ ".": "#000000" }));
    expect(() => loadPalette(dot)).toThrow(/single char/);
    const hex = path.join(dir, "hex.json");
    writeFileSync(hex, JSON.stringify({ x: "red" }));
    expect(() => loadPalette(hex)).toThrow(/invalid color/);
  });
});

describe("parseGrid", () => {
  it("parses a well-formed grid", () => {
    const dir = tmp();
    const file = path.join(dir, "ok.grid");
    writeFileSync(file, "..k\nkkk\n..k\n");
    expect(parseGrid(file, 3, 3, PALETTE)).toEqual(["..k", "kkk", "..k"]);
  });

  it("rejects wrong row count, ragged rows, unknown chars", () => {
    const dir = tmp();
    const rows = path.join(dir, "rows.grid");
    writeFileSync(rows, "..k\nkkk\n");
    expect(() => parseGrid(rows, 3, 3, PALETTE)).toThrow(/expected 3 rows, got 2/);
    const ragged = path.join(dir, "ragged.grid");
    writeFileSync(ragged, "..k\nkk\n..k\n");
    expect(() => parseGrid(ragged, 3, 3, PALETTE)).toThrow(/ragged\.grid:2/);
    const unknown = path.join(dir, "unknown.grid");
    writeFileSync(unknown, "..k\nkZk\n..k\n");
    expect(() => parseGrid(unknown, 3, 3, PALETTE)).toThrow(/unknown palette char "Z"/);
  });
});

describe("loadActor", () => {
  function makeActor(dir: string, opts: { twin?: boolean } = { twin: true }) {
    mkdirSync(path.join(dir, "expr"), { recursive: true });
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ face: { x: 1, y: 1, w: 2, h: 2 } }));
    const baseRow = ".".repeat(CELL);
    writeFileSync(path.join(dir, "base.grid"), Array(CELL).fill(baseRow).join("\n") + "\n");
    writeFileSync(path.join(dir, "expr", "happy_closed.grid"), "kk\nkk\n");
    if (opts.twin) writeFileSync(path.join(dir, "expr", "happy_open.grid"), "kk\n..\n");
  }

  it("loads base, face box, and expressions", () => {
    const dir = path.join(tmp(), "demo");
    makeActor(dir);
    const a = loadActor(dir, PALETTE);
    expect(a.id).toBe("demo");
    expect(a.base.length).toBe(CELL);
    expect(a.face).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(Object.keys(a.expr).sort()).toEqual(["happy_closed", "happy_open"]);
  });

  it("rejects a missing closed/open twin", () => {
    const dir = path.join(tmp(), "demo");
    makeActor(dir, { twin: false });
    expect(() => loadActor(dir, PALETTE)).toThrow(/missing happy_open/);
  });

  it("rejects an out-of-bounds face box", () => {
    const dir = path.join(tmp(), "demo");
    makeActor(dir);
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ face: { x: 28, y: 1, w: 8, h: 2 } }));
    expect(() => loadActor(dir, PALETTE)).toThrow(/face box out of bounds/);
  });

  it("rejects a face box missing w/h", () => {
    const dir = path.join(tmp(), "demo");
    makeActor(dir);
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ face: { x: 1, y: 1 } }));
    expect(() => loadActor(dir, PALETTE)).toThrow(/missing or invalid face box/);
  });

  it("rejects a meta.json with no face key", () => {
    const dir = path.join(tmp(), "demo");
    makeActor(dir);
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({}));
    expect(() => loadActor(dir, PALETTE)).toThrow(/missing or invalid face box/);
  });
});

function writeTempActor(opts: {
  face: { x: number; y: number; w: number; h: number };
  base: string[];
  expr: Record<string, string[]>;
}): string {
  const dir = path.join(tmp(), "demo");
  mkdirSync(path.join(dir, "expr"), { recursive: true });
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ face: opts.face }));
  const baseRow = ".".repeat(CELL);
  writeFileSync(path.join(dir, "base.grid"), Array(CELL).fill(baseRow).join("\n") + "\n");
  for (const [name, rows] of Object.entries(opts.expr)) {
    writeFileSync(path.join(dir, "expr", `${name}.grid`), rows.join("\n") + "\n");
  }
  return dir;
}

describe("double-resolution expression overlays", () => {
  it("accepts an expr grid at exactly 2x the face box", () => {
    // face 2x1 -> overlay may be 4x2
    const dir = writeTempActor({
      face: { x: 0, y: 0, w: 2, h: 1 },
      base: ["..", ".."],
      expr: { neutral_closed: ["rrrr", "rrrr"], neutral_open: ["rrrr", "rrrr"] },
    });
    const a = loadActor(dir, PALETTE);
    expect(a.expr["neutral_closed"]).toEqual(["rrrr", "rrrr"]);
  });

  it("rejects an expr grid at any other multiple", () => {
    const dir = writeTempActor({
      face: { x: 0, y: 0, w: 2, h: 1 },
      base: ["..", ".."],
      expr: { neutral_closed: ["rrrrrr", "rrrrrr", "rrrrrr"], neutral_open: ["rr"] },
    });
    expect(() => loadActor(dir, PALETTE)).toThrow();
  });
});

describe("tuk reference art", () => {
  it("loads through loadActor cleanly", () => {
    const dir = new URL("../sprites/actors/tuk", import.meta.url).pathname;
    const a = loadActor(dir, PALETTE);
    expect(a.id).toBe("tuk");
    expect(a.face).toEqual({ x: 6, y: 4, w: 16, h: 10 });
    // tuk's full expression inventory is asserted in tests/art-inventory.test.ts;
    // here we only care that the reference art parses and pairs up.
    expect(Object.keys(a.expr)).toEqual(expect.arrayContaining(["happy_closed", "happy_open"]));
  });
});

// The whole troupe ships double-resolution faces. A re-authored 1x grid would
// load fine but silently halve the eye detail, so pin the resolution here.
describe("troupe hi-res overlays", () => {
  const HIRES = ["ada", "bruno", "milo", "rosa", "pip", "tuk", "miss_moon"];
  it.each(HIRES)("%s stores every overlay at double the face box resolution", (id) => {
    const dir = new URL(`../sprites/actors/${id}`, import.meta.url).pathname;
    const a = loadActor(dir, PALETTE);
    for (const [name, rows] of Object.entries(a.expr)) {
      expect(rows.length, `${id}/${name} rows`).toBe(a.face.h * 2);
      expect(rows[0].length, `${id}/${name} cols`).toBe(a.face.w * 2);
    }
  });
});

describe("loadLayerArt", () => {
  const LAYERS_DIR = new URL("../sprites/layers", import.meta.url).pathname;

  function writeTempLayer(grid: string[], meta: object): string {
    const dir = tmp();
    mkdirSync(path.join(dir, "headwear"));
    writeFileSync(path.join(dir, "headwear", "thing.grid"), grid.join("\n") + "\n");
    writeFileSync(path.join(dir, "headwear", "thing.json"), JSON.stringify(meta));
    return dir;
  }

  it("loads horns with dimensions inferred from the grid file", () => {
    const horns = loadLayerArt(LAYERS_DIR, "headwear", "horns", PALETTE);
    expect(horns).toMatchObject({ id: "horns", slot: "headwear", w: 32, h: 8, dx: 0, dy: 0, density: 2 });
    expect(horns.grid).toHaveLength(8);
  });

  it("defaults missing offsets to 0", () => {
    const dir = writeTempLayer(["rr"], {});
    const art = loadLayerArt(dir, "headwear", "thing", PALETTE);
    expect({ dx: art.dx, dy: art.dy, w: art.w, h: art.h }).toEqual({ dx: 0, dy: 0, w: 2, h: 1 });
  });

  it("rejects a ragged grid", () => {
    const dir = writeTempLayer(["rrr", "rr"], {});
    expect(() => loadLayerArt(dir, "headwear", "thing", PALETTE)).toThrow(/expected 3 chars/);
  });

  it("rejects a grid wider than the cell", () => {
    const dir = writeTempLayer(["r".repeat(CELL + 1)], {});
    expect(() => loadLayerArt(dir, "headwear", "thing", PALETTE)).toThrow(/between 1x1/);
  });

  it("rejects an interior blank row instead of silently dropping it", () => {
    const dir = writeTempLayer(["rr", "", "rr"], {});
    expect(() => loadLayerArt(dir, "headwear", "thing", PALETTE)).toThrow();
  });

  it("rejects a non-integer offset", () => {
    const dir = writeTempLayer(["rr"], { dy: 1.5 });
    expect(() => loadLayerArt(dir, "headwear", "thing", PALETTE)).toThrow(/must be an integer/);
  });

  it("anchors face-box centered with the bottom row above the face top", () => {
    const actor = { face: { x: 6, y: 4, w: 16, h: 10 }, base: [".".repeat(CELL)] };
    // Synthetic 16x4 density-1 grid rather than the real horns art: this test's
    // subject is the anchor formula, not the art, so it must not move when the
    // production art's dimensions or density change.
    const horns: LayerArt = {
      id: "horns",
      slot: "headwear",
      grid: Array(4).fill("r".repeat(16)),
      w: 16,
      h: 4,
      dx: 0,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    // 16-wide art on a 16-wide face centers at face.x; the 4-tall grid sits
    // entirely above the face box, rooted on tuk's head-top outline row.
    // At scale 1 a render pixel is a cell pixel.
    expect(layerAnchor(actor, horns, 1)).toEqual({ x: 6, y: 0, px: 1 });
  });

  it("anchors a back_prop above the actor's ink box, not its face box", () => {
    // ink occupies rows 2-3, columns 4-9 (width 6); a 4-wide, 2-tall wing
    // centres at 4 + (6-4)/2 = 5 and sits with its bottom row on row 1.
    const actor = {
      face: { x: 0, y: 0, w: 2, h: 2 },
      base: ["..........", "..........", "....rrrrrr", "....rrrrrr"],
    };
    const art: LayerArt = {
      id: "w",
      slot: "back_prop",
      grid: ["rrrr", "rrrr"],
      w: 4,
      h: 2,
      dx: 0,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    expect(layerAnchor(actor, art, 1)).toEqual({ x: 5, y: 0, px: 1 });
  });

  it("slides a back_prop down behind the body with a positive dy", () => {
    const actor = {
      face: { x: 0, y: 0, w: 2, h: 2 },
      base: ["..........", "..........", "....rrrrrr", "....rrrrrr"],
    };
    const art: LayerArt = {
      id: "w",
      slot: "back_prop",
      grid: ["rrrr", "rrrr"],
      w: 4,
      h: 2,
      dx: 0,
      dy: 3,
      density: 1,
      bleedX: 0,
    };
    expect(layerAnchor(actor, art, 1)).toEqual({ x: 5, y: 3, px: 1 });
  });

  it("anchors a front_prop centred over the hand pixel, bottom row on the hand row", () => {
    // A grip is covered by the hand, not perched above it like a crown above
    // a face — so the bottom row lands ON hand.y, not the row above it.
    const actor = {
      face: { x: 0, y: 0, w: 2, h: 2 },
      base: ["..........", "..........", "....rrrrrr", "....rrrrrr"],
      hand: { x: 6, y: 2 },
    };
    const art: LayerArt = {
      id: "s",
      slot: "front_prop",
      grid: ["rr", "rr", "rr"],
      w: 2,
      h: 3,
      dx: 0,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    // x = 6 + floor((1-2)/2) = 5; y = (2+1) - 3 = 0.
    expect(layerAnchor(actor, art, 1)).toEqual({ x: 5, y: 0, px: 1 });
  });

  it("scales a density-2 front_prop into render pixels around the hand", () => {
    const actor = {
      face: { x: 10, y: 5, w: 12, h: 8 },
      base: [".".repeat(CELL)],
      hand: { x: 21, y: 23 },
    };
    const art: LayerArt = {
      id: "s",
      slot: "front_prop",
      grid: Array(6).fill("rrrr"),
      w: 4,
      h: 6,
      dx: 0,
      dy: 0,
      density: 2,
      bleedX: 0,
    };
    // px = 6/2 = 3; x = 21*6 + floor((2-4)/2)*3 = 126 - 3 = 123;
    // y = (23+1)*6 - 6*3 = 144 - 18 = 126.
    expect(layerAnchor(actor, art, 6)).toEqual({ x: 123, y: 126, px: 3 });
  });

  it("shifts a front_prop by dx/dy in the layer's own pixels", () => {
    const actor = {
      face: { x: 0, y: 0, w: 2, h: 2 },
      base: ["..........", "..........", "....rrrrrr", "....rrrrrr"],
      hand: { x: 6, y: 2 },
    };
    const art: LayerArt = {
      id: "s",
      slot: "front_prop",
      grid: ["rr", "rr", "rr"],
      w: 2,
      h: 3,
      dx: 1,
      dy: -1,
      density: 1,
      bleedX: 0,
    };
    expect(layerAnchor(actor, art, 1)).toEqual({ x: 6, y: -1, px: 1 });
  });

  it("refuses a front_prop on a wearer with no hand anchor", () => {
    const actor = { face: { x: 0, y: 0, w: 2, h: 2 }, base: ["...."] };
    const art: LayerArt = {
      id: "s",
      slot: "front_prop",
      grid: ["rr"],
      w: 2,
      h: 1,
      dx: 0,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    expect(() => layerAnchor(actor, art, 1)).toThrow(/hand anchor/);
  });

  it("scales the anchor into render pixels", () => {
    const actor = { face: { x: 6, y: 4, w: 16, h: 10 }, base: [".".repeat(CELL)] };
    // Synthetic 16x4 density-1 grid rather than the real horns art: this test's
    // subject is the scale arithmetic, not the art, so it must not move when the
    // production art's dimensions or density change.
    const horns: LayerArt = {
      id: "horns",
      slot: "headwear",
      grid: Array(4).fill("r".repeat(16)),
      w: 16,
      h: 4,
      dx: 0,
      dy: 0,
      density: 1,
      bleedX: 0,
    };
    // Same placement as the scale-1 case, in 6x render pixels: every term
    // multiplied through, and a density-1 grid cell draws 6px square.
    expect(layerAnchor(actor, horns, 6)).toEqual({ x: 36, y: 0, px: 6 });
  });

  it("draws density-2 art at half the step, centering on the layer's own pixel", () => {
    const actor = { face: { x: 6, y: 4, w: 16, h: 10 }, base: [".".repeat(CELL)] };
    // 32 layer-pixels wide on a 16-cell-wide face box at density 2 is an
    // exact fit, so it centers at face.x with no slack: x = 6*6 = 36.
    // 8 layer-rows tall at px=3 is 24 render px, sitting on face.y*6 = 24.
    const art: LayerArt = {
      id: "hi",
      slot: "headwear",
      grid: Array.from({ length: 8 }, () => "r".repeat(32)),
      w: 32,
      h: 8,
      dx: 0,
      dy: 0,
      density: 2,
      bleedX: 0,
    };
    expect(layerAnchor(actor, art, 6)).toEqual({ x: 36, y: 0, px: 3 });
  });

  it("nudges density-2 art by half a base pixel per dx unit", () => {
    const actor = { face: { x: 6, y: 4, w: 16, h: 10 }, base: [".".repeat(CELL)] };
    const art: LayerArt = {
      id: "hi",
      slot: "headwear",
      grid: Array.from({ length: 8 }, () => "r".repeat(32)),
      w: 32,
      h: 8,
      dx: 1,
      dy: 0,
      density: 2,
      bleedX: 0,
    };
    // dx is in layer pixels, so one unit moves 3 render px, not 6.
    expect(layerAnchor(actor, art, 6).x).toBe(39);
  });

  it("centers odd slack on the layer's pixel grid, not the render grid", () => {
    const actor = { face: { x: 0, y: 4, w: 12, h: 8 }, base: [".".repeat(CELL)] };
    // 21 layer-pixels on a 12-cell face box at density 2 = 24 layer-pixels:
    // slack 3, floor(3/2) = 1 layer pixel = 3 render px.
    const art: LayerArt = {
      id: "hi",
      slot: "headwear",
      grid: Array.from({ length: 2 }, () => "r".repeat(21)),
      w: 21,
      h: 2,
      dx: 0,
      dy: 0,
      density: 2,
      bleedX: 0,
    };
    expect(layerAnchor(actor, art, 6).x).toBe(3);
  });

  it("rejects a scale the density does not divide", () => {
    const actor = { face: { x: 0, y: 4, w: 12, h: 8 }, base: [".".repeat(CELL)] };
    const art: LayerArt = {
      id: "hi",
      slot: "headwear",
      grid: ["rr"],
      w: 2,
      h: 1,
      dx: 0,
      dy: 0,
      density: 2,
      bleedX: 0,
    };
    expect(() => layerAnchor(actor, art, 5)).toThrow(/scale 5 is not divisible by density 2/);
  });

  it("defaults a missing density to 1", () => {
    const dir = writeTempLayer(["rr"], {});
    expect(loadLayerArt(dir, "headwear", "thing", PALETTE).density).toBe(1);
  });

  it("reads a declared density of 2", () => {
    const dir = writeTempLayer(["rr"], { density: 2 });
    expect(loadLayerArt(dir, "headwear", "thing", PALETTE).density).toBe(2);
  });

  it("rejects a density that is neither 1 nor 2", () => {
    const dir = writeTempLayer(["rr"], { density: 3 });
    expect(() => loadLayerArt(dir, "headwear", "thing", PALETTE)).toThrow(/"density" must be 1 or 2/);
  });

  it("rejects a non-integer density", () => {
    const dir = writeTempLayer(["rr"], { density: 1.5 });
    expect(() => loadLayerArt(dir, "headwear", "thing", PALETTE)).toThrow(/"density" must be 1 or 2/);
  });

  it("allows a density-2 grid up to twice the cell", () => {
    const dir = writeTempLayer(["r".repeat(CELL * 2)], { density: 2 });
    expect(loadLayerArt(dir, "headwear", "thing", PALETTE).w).toBe(CELL * 2);
  });

  it("still caps a density-2 grid at twice the cell", () => {
    const dir = writeTempLayer(["r".repeat(CELL * 2 + 1)], { density: 2 });
    expect(() => loadLayerArt(dir, "headwear", "thing", PALETTE)).toThrow(/between 1x1 and 64x64/);
  });
});

describe("loadLayerArt bleed_x", () => {
  // A scratch layer dir, so these cases do not depend on catalog art that
  // other tests also assert against.
  const scratchLayer = (meta: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "bleed-"));
    mkdirSync(path.join(dir, "headwear"), { recursive: true });
    writeFileSync(path.join(dir, "headwear", "probe.grid"), "kk\nkk\n");
    writeFileSync(path.join(dir, "headwear", "probe.json"), meta);
    return dir;
  };

  it("defaults bleedX to 0 when the sidecar omits it", () => {
    const dir = scratchLayer(`{ "dx": 0, "dy": 0 }`);
    expect(loadLayerArt(dir, "headwear", "probe", PALETTE).bleedX).toBe(0);
  });

  it("reads a declared bleed_x", () => {
    const dir = scratchLayer(`{ "dx": 0, "dy": 0, "bleed_x": 12 }`);
    expect(loadLayerArt(dir, "headwear", "probe", PALETTE).bleedX).toBe(12);
  });

  it("rejects a negative bleed_x", () => {
    const dir = scratchLayer(`{ "bleed_x": -1 }`);
    expect(() => loadLayerArt(dir, "headwear", "probe", PALETTE)).toThrow(/bleed_x/);
  });

  it("rejects a non-integer bleed_x", () => {
    const dir = scratchLayer(`{ "bleed_x": 1.5 }`);
    expect(() => loadLayerArt(dir, "headwear", "probe", PALETTE)).toThrow(/bleed_x/);
  });
});

// The catalog is the contract a story casts against: a director may write
// `headwear: "witch_hat"` only because troupe.json says the item exists and
// says who it fits. These two tests are that contract's guard rails.
describe("the layer catalog", () => {
  const TROUPE = loadTroupe();
  const ACTORS_DIR = new URL("../sprites/actors", import.meta.url).pathname;
  const LAYERS_DIR = new URL("../sprites/layers", import.meta.url).pathname;
  const headwear = (id: string) => TROUPE.layers.find((l) => l.slot === "headwear" && l.id === id);

  // The crown is an object and fits every human head; the fringe is hair, so
  // it carries a hair colour and fits exactly the one head that colour matches
  // -- ada's. The pair is the catalog's object-vs-hair distinction in one test:
  // author-once generalises across a slot only when the item isn't a body part.
  it("carries a crown any human can wear and a fringe only ada can", () => {
    expect(headwear("crown")?.fits).toEqual(["human"]);
    expect(headwear("fringe")?.fits).toEqual(["ada"]);
  });

  // Pip plays many roles and has the least to tell them apart. Headwear for
  // him must not compete with the tufts in his base art: `antennae` rise from
  // between them and read as their continuation. This keeps a trimmed catalog
  // from leaving him with no headwear at all.
  it("gives pip at least one headwear", () => {
    const forPip = TROUPE.layers.filter((l) => l.slot === "headwear" && l.fits.includes("pip"));
    expect(forPip.map((l) => l.id)).toContain("antennae");
  });

  // The witch hat is scoped to a single actor too, but for a reason unrelated
  // to the fringe's: not colour but headroom, and headroom above a face box IS
  // face.y -- a short actor's head sits low in the cell, so it has the most
  // room above it. Rosa's face box starts at row
  // 11 against ada's 6 and bruno/milo's 5, which is the only budget on the
  // troupe that fits a cone tall enough to read as a witch rather than a flat
  // cap. Widening this to "human" without re-authoring will fail the
  // lands-on-screen check below on bruno first.
  it("scopes the witch hat to rosa, the short actor with the most headroom", () => {
    expect(headwear("witch_hat")?.fits).toEqual(["rosa"]);
  });

  // The one back_prop: a butterfly pair for the upright actors whose body
  // doesn't already fill the frame. Scoped by id rather than category because
  // the fit is about body shape (an upright back the wings can spread from),
  // not about being an animal or a human. tuk (a side-on quadruped) and bruno
  // (whose body already fills the frame) are excluded on purpose.
  it("catalogs wings as a back_prop fitting the upright actors, not tuk or bruno", () => {
    const wings = TROUPE.layers.find((l) => l.slot === "back_prop" && l.id === "wings");
    expect(wings?.fits).toEqual(["pip", "rosa", "milo", "ada"]);
  });

  // The sword is an object like the crown, not hair like the fringe, so
  // author-once holds and it fits the whole human category. It is the first
  // item of the held-prop slot.
  it("catalogs the sword as a front_prop fitting every human", () => {
    const sword = TROUPE.layers.find((l) => l.slot === "front_prop" && l.id === "sword");
    expect(sword?.fits).toEqual(["human"]);
  });

  // Every actor a layer claims to fit, expanded from ids and categories alike:
  // "human" has to hold for all four, and bruno/milo's face box sits highest
  // in the cell, so they are what caps a hat's height.
  const wearers = (fits: readonly string[]) =>
    TROUPE.actors.filter((a) => fits.includes(a.id) || fits.includes(a.category)).map((a) => a.id);
  const cases = TROUPE.layers.flatMap((l) => wearers(l.fits).map((actor) => [l.id, actor, l.slot] as const));

  // The check that matters: the 32x32 cell is not the screen. At 6x a full
  // cell is 192px against a 135px screen and placement centres on the ink box,
  // so cell columns near either edge never reach the display. Art can sit
  // squarely inside the cell and still be clipped on device.
  it.each(cases)("%s lands on screen on %s", (id, actor, slot) => {
    const art = loadLayerArt(LAYERS_DIR, slot, id, PALETTE);
    const actorArt = loadActor(path.join(ACTORS_DIR, actor), PALETTE);
    const over = screenOverflow(
      actor,
      actorArt.base,
      layerAnchor(actorArt, art, actorScale(actor)),
      art.grid,
    );
    const violation = overflowViolation(over, art.bleedX);
    expect(violation && `${id} on ${actor}: ${describeViolation(violation, art.bleedX)}`).toBeNull();
  });
});

describe("overflowViolation", () => {
  const over = (l: number, r: number, t = 0, b = 0) => ({ left: l, right: r, top: t, bottom: b });

  it("passes a null overflow through", () => {
    expect(overflowViolation(null, 0)).toBeNull();
  });

  it("still reports everything when nothing is declared", () => {
    expect(overflowViolation(over(11, 10), 0)).toEqual(over(11, 10));
  });

  it("forgives horizontal overflow inside the budget", () => {
    expect(overflowViolation(over(11, 10), 12)).toBeNull();
  });

  it("forgives exactly the budget", () => {
    expect(overflowViolation(over(12, 12), 12)).toBeNull();
  });

  it("reports only the excess beyond the budget", () => {
    expect(overflowViolation(over(20, 14), 12)).toEqual(over(8, 2));
  });

  // No budget forgives vertical overflow: above the actor is headroom the
  // bound already allows, and below the baseline is under the floor.
  it("never forgives vertical overflow, however large the budget", () => {
    expect(overflowViolation(over(0, 0, 5, 0), 999)).toEqual(over(0, 0, 5, 0));
    expect(overflowViolation(over(0, 0, 0, 7), 999)).toEqual(over(0, 0, 0, 7));
  });

  it("keeps vertical overflow while forgiving horizontal in the same result", () => {
    expect(overflowViolation(over(11, 10, 3, 0), 12)).toEqual(over(0, 0, 3, 0));
  });
});

// A violation is the RESIDUAL, not the overflow -- art 11px past the edge
// against a 4px allowance reports 7. Read without the budget, that 7 is an
// instruction to trim seven columns off art that only ever needed four
// trimmed, so every site that reports a violation names the budget too.
describe("describeViolation", () => {
  const over = (l: number, r: number, t = 0, b = 0) => ({ left: l, right: r, top: t, bottom: b });

  it("reads exactly like describeOverflow when nothing was declared", () => {
    expect(describeViolation(over(11, 10), 0)).toBe("11px off the left, 10px off the right");
  });

  it("names the budget the art already spent", () => {
    expect(describeViolation(over(7, 6), 4)).toBe(
      "7px off the left, 6px off the right beyond its declared bleed_x of 4px",
    );
  });

  // Naming a horizontal budget on a vertical failure would imply raising it
  // could help. It cannot: vertical is refused at any budget.
  it("stays silent about the budget on a purely vertical violation", () => {
    expect(describeViolation(over(0, 0, 5, 0), 12)).toBe("5px off the top");
  });

  it("names the budget when a mixed violation still has a horizontal part", () => {
    expect(describeViolation(over(3, 0, 5, 0), 12)).toBe(
      "3px off the left, 5px off the top beyond its declared bleed_x of 12px",
    );
  });
});
