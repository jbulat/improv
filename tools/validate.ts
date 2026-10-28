import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCli, runCli } from "./lib/cli";
import { validatePerformance, type Issue } from "./lib/validator";
import { loadTroupe, DEFAULT_TROUPE_PATH } from "./lib/troupe";

/** Print every issue and the verdict. Exits 1 when the performance is invalid. */
export function main(argv: string[]): number {
  const { values, positionals } = parseCli(argv, {
    usage: "usage: npm run validate -- <performance.json> [--check-files] [--troupe <troupe.json>]",
    options: {
      "check-files": { type: "boolean" },
      troupe: { type: "string", default: DEFAULT_TROUPE_PATH },
    },
    positionals: ["<performance.json>"],
  });
  const [perfPath] = positionals;
  const troupe = loadTroupe(values.troupe);
  const perf: unknown = JSON.parse(readFileSync(perfPath, "utf8"));

  const result = validatePerformance(
    perf,
    troupe,
    values["check-files"] ? { checkFilesDir: path.dirname(perfPath) } : {},
  );

  const print = (issue: Issue) =>
    console.log(`${issue.level.toUpperCase().padEnd(7)} [${issue.code}] ${issue.path} — ${issue.message}`);
  result.errors.forEach(print);
  result.warnings.forEach(print);
  console.log(
    result.ok
      ? `✓ ${perfPath} is a valid Performance (${result.warnings.length} warning(s))`
      : `✗ ${perfPath}: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
  );
  return result.ok ? 0 : 1;
}

runCli(import.meta.url, main);
