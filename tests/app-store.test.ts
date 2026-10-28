// Host test for the firmware's app-source persistence rules
// (device/lib/drivers/src/AppStoreCore.h). Compiles a small C++ harness with
// the system compiler and drives it over a real temp directory, so the atomic
// write and the skipped identical rewrite are checked against a filesystem
// rather than a mock.
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HARNESS_SRC = "tests/helpers/app-store-harness.cpp";

let workRoot: string;
let bin: string;
let caseCount = 0;

/** A fresh, empty store directory per case. */
function newStore(): string {
  const dir = path.join(workRoot, `store-${caseCount++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(dir: string, ...args: string[]): string {
  return execFileSync(bin, [dir, ...args], { encoding: "utf8" }).trim();
}

/** Writes `content` to a scratch file and saves it through the harness. */
function save(dir: string, content: string): { ok: boolean; writes: number } {
  const src = path.join(workRoot, `content-${caseCount++}.lua`);
  writeFileSync(src, content);
  const out = run(dir, "save", src);
  const m = /^save (ok|err) writes=(\d+)$/.exec(out);
  if (!m) throw new Error(`unparsable harness output: ${out}`);
  return { ok: m[1] === "ok", writes: Number(m[2]) };
}

function loadLen(dir: string): number {
  return Number(/^load (\d+)$/.exec(run(dir, "load"))![1]);
}

function loadContent(dir: string): string {
  const out = path.join(workRoot, `out-${caseCount++}.lua`);
  run(dir, "load", out);
  return existsSync(out) ? readFileSync(out, "utf8") : "";
}

// See the note in tests/wav-reader.test.ts: a real C++ compile can overrun
// vitest's 10s hook default when the suite runs across parallel workers.
beforeAll(() => {
  workRoot = mkdtempSync(path.join(tmpdir(), "app-store-"));
  bin = path.join(workRoot, "app-store-harness");
  execFileSync(process.env.CXX ?? "c++", ["-std=c++17", "-O1", "-o", bin, HARNESS_SRC]);
}, 120_000);

describe("AppStoreCore (app-source persistence, host-compiled)", () => {
  it("reports nothing stored in a fresh store", () => {
    expect(loadLen(newStore())).toBe(0);
  });

  it("saves and reads back exact bytes", () => {
    const dir = newStore();
    const body = "function init(ctx) end\n-- éè non-ascii stays intact\n";
    expect(save(dir, body).ok).toBe(true);
    expect(loadContent(dir)).toBe(body);
  });

  it("leaves no temp file behind after a successful save", () => {
    const dir = newStore();
    save(dir, "print('hi')\n");
    expect(run(dir, "state")).toMatch(/ tmp=0$/);
  });

  it("skips the write when content is identical", () => {
    const dir = newStore();
    const body = "return 1\n";
    expect(save(dir, body).writes).toBe(1);
    // The boot restore re-enters save() on every power-on; an identical body
    // must not rewrite the file.
    expect(save(dir, body).writes).toBe(0);
  });

  it("rewrites when content differs", () => {
    const dir = newStore();
    save(dir, "return 1\n");
    expect(save(dir, "return 2\n").writes).toBe(1);
    expect(loadContent(dir)).toBe("return 2\n");
  });

  it("distinguishes same-length different content", () => {
    const dir = newStore();
    save(dir, "aaaa");
    // Equal size must not be mistaken for equal content.
    expect(save(dir, "bbbb").writes).toBe(1);
    expect(loadContent(dir)).toBe("bbbb");
  });

  it("handles content larger than one compare chunk", () => {
    const dir = newStore();
    const big = "x".repeat(40_000); // > COMPARE_CHUNK, and > a real app
    expect(save(dir, big).ok).toBe(true);
    expect(loadLen(dir)).toBe(40_000);
    expect(save(dir, big).writes).toBe(0);
  });

  it("overwrites a stale temp file from an interrupted save", () => {
    const dir = newStore();
    writeFileSync(path.join(dir, "app.lua.tmp"), "garbage from a dead boot");
    expect(save(dir, "return 3\n").ok).toBe(true);
    expect(loadContent(dir)).toBe("return 3\n");
    expect(run(dir, "state")).toMatch(/ tmp=0$/);
  });

  it("refuses to store an empty app", () => {
    const dir = newStore();
    expect(save(dir, "").ok).toBe(false);
    expect(loadLen(dir)).toBe(0);
  });

  it("clears the stored app", () => {
    const dir = newStore();
    save(dir, "return 4\n");
    run(dir, "clear");
    expect(loadLen(dir)).toBe(0);
  });
});
