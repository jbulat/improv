import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCli, runCli } from "./lib/cli";
import { basePerformance } from "./lib/fixture-base";
import { INVALID_CASES } from "./lib/invalid-cases";

export function main(argv: string[]): void {
  parseCli(argv, { usage: "usage: npm run gen:invalid" });
  const outDir = "fixtures/invalid";
  mkdirSync(outDir, { recursive: true });
  for (const c of INVALID_CASES) {
    const p = basePerformance();
    c.mutate(p);
    writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify(p, null, 2) + "\n");
    console.log(`wrote ${c.name}.json (expects ${c.code})`);
  }
}

runCli(import.meta.url, main);
