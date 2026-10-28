import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validatePerformance } from "../tools/lib/validator";
import { INVALID_CASES } from "../tools/lib/invalid-cases";
import type { Troupe } from "../tools/lib/types";

const troupe: Troupe = JSON.parse(readFileSync("troupe/troupe.json", "utf8"));

// Guards the COMMITTED fixture files (not just the in-memory mutations):
// each file must trip the code named in its case.
describe("fixtures/invalid", () => {
  for (const c of INVALID_CASES) {
    it(`${c.name}.json trips ${c.code}`, () => {
      const perf = JSON.parse(readFileSync(`fixtures/invalid/${c.name}.json`, "utf8"));
      const r = validatePerformance(perf, troupe);
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => e.code)).toContain(c.code);
    });
  }
});
