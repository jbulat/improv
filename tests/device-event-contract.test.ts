import { readFileSync, readdirSync } from "node:fs";
import * as nodeFs from "node:fs";
import { describe, it, expect } from "vitest";

// Resident v0.8.3 delivers every event payload under `e.data`.
// The simulator host, the app, and the authoring contract must agree, or a
// story passes in the sim and does nothing on the device -- silently, because
// a missing field reads as nil rather than raising.

const root = new URL("../", import.meta.url).pathname;
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url).pathname, "utf8");

// Resolve a glob (a single "<dir>/*.<ext>" pattern) relative to the project
// root. Prefers node:fs's built-in globSync where available (Node 22+);
// falls back to a plain directory listing + extension filter otherwise, so
// this never needs a new dependency.
function resolveGlob(pattern: string): string[] {
  const globSync = (nodeFs as { globSync?: (p: string, o: { cwd: string }) => string[] }).globSync;
  if (typeof globSync === "function") {
    return globSync(pattern, { cwd: root }).sort();
  }
  const slash = pattern.lastIndexOf("/");
  const dir = pattern.slice(0, slash);
  const ext = pattern.slice(slash + 1).replace("*", "");
  return readdirSync(new URL(`../${dir}/`, import.meta.url).pathname)
    .filter((f) => f.endsWith(ext))
    .map((f) => `${dir}/${f}`)
    .sort();
}

describe("driver event payload shape", () => {
  it("the simulator host nests the button payload under data", () => {
    const host = read("tools/lib/sim-host.lua");
    // Whole-file match, not line-by-line: the event table is constructed
    // across several lines, so `name` and `data` do not share a line.
    expect(host, "sim-host.lua must construct a button event").toMatch(/name\s*=\s*"button"/);
    expect(host, "sim-host must emit data = { index = ... }, not a flat index").toMatch(
      /name\s*=\s*"button"[\s\S]{0,200}?data\s*=\s*\{[^}]*index/,
    );
  });

  it("no source or contract file reads a flattened e.index", () => {
    // Globs so a new app under device/apps/, or a new handler in one of the
    // chunks that compose into the shipped app, is guarded from birth
    // instead of needing to be remembered and added to a hardcoded list.
    const files = [
      ...resolveGlob("device-apps/improv/src/*.lua"),
      ...resolveGlob("device/apps/*.lua"),
      ...resolveGlob("tests/lua/*.lua"),
      "DEVICE-SKILL.md",
      "tools/lib/sim-host.lua",
    ];
    // A glob that silently matches nothing would turn this guard into a test
    // that cannot fail.
    expect(files.length, "resolved file list must not be empty").toBeGreaterThan(0);

    // Covers e.index, ev.index, evt.index, and event.index -- the last of
    // which is the exact form used in an upstream doc that authors copy from.
    const offenderPattern = /\b(e|ev|evt|event)\.index\b/;
    const offenders = files.filter((f) => offenderPattern.test(read(f)));
    expect(offenders, "these read the pre-v0.8.3 flattened field; use e.data.index").toEqual([]);
  });

  it("main.lua and viewer.lua read the nested event field", () => {
    // The anti-pattern check above only forbids the old flattened read; on
    // its own it would also pass a file that dropped its handler entirely
    // or renamed the field. Pin the positive shape too.
    expect(read("device-apps/improv/src/main.lua")).toContain("e.data.index");
    expect(read("device-apps/improv/src/viewer.lua")).toContain("e.data.index");
  });

  it("the simulator host pins the driver channel", () => {
    expect(read("tools/lib/sim-host.lua")).toContain('channel = "driver"');
  });
});
