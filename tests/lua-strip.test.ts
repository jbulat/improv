import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildAppSource, stripLuaComments } from "../tools/build-app";
import { bundleDirs, loadBundle } from "../tools/lib/bundle";
import { emitPerformanceLua } from "../tools/gen-performance-data";

// The strip runs over every byte of a bundle, and a bundle bakes story text:
// titles, character names, audio paths. A line-based `--` strip would eat the
// middle of any of those. These cases are the lexical states a Lua 5.4 scanner
// has to keep apart -- each one is a string that CONTAINS comment syntax, or a
// comment that contains string syntax.
describe("stripLuaComments", () => {
  it("removes a short comment but keeps the code before it", () => {
    expect(stripLuaComments("local h = 3 -- trailing\n")).toBe("local h = 3\n");
  });

  it("removes a comment-only line's text and leaves the line", () => {
    expect(stripLuaComments("a\n-- gone\nb\n")).toBe("a\n\nb\n");
  });

  it("removes a bare -- with nothing after it", () => {
    expect(stripLuaComments("a\n--\nb\n")).toBe("a\n\nb\n");
  });

  it("keeps -- inside a double-quoted string", () => {
    const src = 'local a = "text -- not a comment"\n';
    expect(stripLuaComments(src)).toBe(src);
  });

  it("keeps -- inside a single-quoted string", () => {
    const src = "local b = 'single -- also not'\n";
    expect(stripLuaComments(src)).toBe(src);
  });

  it("keeps -- inside a baked audio path", () => {
    const src = 'local g = "stories/a--b/aud_000.wav"\n';
    expect(stripLuaComments(src)).toBe(src);
  });

  it("keeps a quote that only looks like a terminator because it is escaped", () => {
    const src = 'local e = "escaped \\" still inside -- not a comment"\n';
    expect(stripLuaComments(src)).toBe(src);
  });

  it("keeps -- inside a long-bracket string", () => {
    // Layer art grids are emitted as [[ ... ]], and a grid is arbitrary text.
    const src = "local c = [[long -- not a comment\nstill inside]]\n";
    expect(stripLuaComments(src)).toBe(src);
  });

  it("keeps a levelled long string whole, including a ]] and a --[[ inside it", () => {
    const src = "local d = [==[has ]] and --[[ inside]==]\n";
    expect(stripLuaComments(src)).toBe(src);
  });

  it("removes a long comment and leaves one newline per line it spanned", () => {
    expect(stripLuaComments("a\n--[[ one\ntwo ]]\nb\n")).toBe("a\n\n\nb\n");
  });

  it("removes a levelled long comment that contains a false ]] terminator", () => {
    expect(stripLuaComments("a\n--[==[ ]] still comment ]==]\nb\n")).toBe("a\n\nb\n");
  });

  it("leaves adjacent-bracket indexing alone", () => {
    // `t[ t[1] ]` is indexing, not a long string -- only a literal `[[` opens one.
    const src = "local i = t[ t[1] ]\n";
    expect(stripLuaComments(src)).toBe(src);
  });

  it("trims whitespace a removed trailing comment left behind", () => {
    expect(stripLuaComments("local h = 3   -- gone\n")).toBe("local h = 3\n");
  });

  it("is idempotent", () => {
    const src = 'local a = "-- keep" -- drop\n--[[ drop ]]\nlocal b = 1\n';
    const once = stripLuaComments(src);
    expect(stripLuaComments(once)).toBe(once);
  });

  it("preserves the line count exactly", () => {
    // Line numbers survive the strip, so a device traceback still points at the
    // right line of the artifact that is actually on the device.
    const src = "a\n-- one\n--[[ two\nthree ]]\nb\n";
    expect(stripLuaComments(src).split("\n").length).toBe(src.split("\n").length);
  });
});

// The unit cases above are the lexical states someone can reason about. This is
// the one that cannot be argued with: compile both forms and compare the code
// the VM would actually run. `string.dump(f, true)` strips debug info, so what
// remains is instructions and constants -- every string literal included. If the
// strip ate a byte of a story's text, the constant table differs and this fails.
describe("stripLuaComments preserves compiled meaning", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lua-strip-"));
  const comparer = path.join(dir, "compare.lua");
  writeFileSync(
    comparer,
    "local function dump(p) return (string.dump(assert(loadfile(p)), true)) end\n" +
      'print(dump(arg[1]) == dump(arg[2]) and "SAME" or "DIFFERENT")\n',
  );

  /** Compile both sources and report whether they yield identical bytecode. */
  function sameBytecode(src: string): string {
    const a = path.join(dir, "a.lua");
    const b = path.join(dir, "b.lua");
    writeFileSync(a, src);
    writeFileSync(b, stripLuaComments(src));
    return execFileSync("lua", [comparer, a, b], { encoding: "utf8" }).trim();
  }

  it("compiles a string-heavy chunk to the same bytecode", () => {
    expect(
      sameBytecode(
        [
          'local perf = { title = "A -- B", audio_root = "stories/a--b" }',
          "-- a comment that mentions [[ and ]] and 'quotes'",
          "local grid = [[..kk--kk..\n..cc]]",
          'local names = { "Miss Moon", "Pip -- the mouse" } -- trailing',
          "--[==[ long ]] comment ]==]",
          "return perf, grid, names",
        ].join("\n"),
      ),
    ).toBe("SAME");
  });

  // The hand-written chunks are where the comments actually are -- ~8.5 KB of
  // the ~19 KB of source every bundle carries.
  for (const chunk of readdirSync("device-apps/improv/src").filter((f) => f.endsWith(".lua"))) {
    it(`compiles src/${chunk} to the same bytecode stripped`, () => {
      expect(sameBytecode(readFileSync(path.join("device-apps/improv/src", chunk), "utf8"))).toBe("SAME");
    });
  }

  // And the generated half is where the story text is: titles, character
  // names, audio paths, every line of dialogue. This is the check that would
  // catch a strip eating the middle of a string constant.
  for (const dir of bundleDirs()) {
    it(`compiles the baked performance for ${dir} to the same bytecode stripped`, () => {
      const bundle = loadBundle(dir);
      expect(sameBytecode(emitPerformanceLua(bundle.perf, bundle.name))).toBe("SAME");
    });
  }
});

describe("the built bundle", () => {
  const { source } = buildAppSource("player", "fixtures/meet-the-troupe");

  it("ships no comments", () => {
    // Every line that is left is code. The provenance header is the one
    // deliberate exception -- see below.
    expect(stripLuaComments(source.split("\n").slice(1).join("\n"))).toBe(
      source.split("\n").slice(1).join("\n"),
    );
  });

  it("keeps the provenance header, because the artifact is committed", () => {
    expect(source.startsWith("-- generated by tools/build-app.ts -- do not edit\n")).toBe(true);
  });
});
