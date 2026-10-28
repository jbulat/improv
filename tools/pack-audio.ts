// Stages story audio for the device LittleFS image.
// pack:audio -- --bundle <dir> [--bundle <dir>...]  ->  device/data/stories/<name>/*.wav
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { loadBundle } from "./lib/bundle";
import { ROOT, parseCli, runCli } from "./lib/cli";
import { loadTroupe } from "./lib/troupe";
import { formatValidationErrors, validatePerformance } from "./lib/validator";
import { stagedAudioFiles } from "./lib/staging";

// Must match device/partitions.csv. LittleFS overhead eats a few %, so
// refuse to stage past 96% and print the math.
export const DATA_PARTITION_BYTES = 0x460000;
const BUDGET = Math.floor(DATA_PARTITION_BYTES * 0.96);

export function packAudio(
  bundleDirs: string[],
  outRoot: string = path.join(ROOT, "device/data"),
): { files: number; bytes: number } {
  const troupe = loadTroupe();

  // Validate and size everything before touching the staging tree, so an
  // over-budget or invalid pack leaves it unchanged.
  const staged: { bundleName: string; src: string; base: string }[] = [];
  let bytes = 0;
  for (const dir of bundleDirs) {
    const bundle = loadBundle(dir);
    const result = validatePerformance(bundle.perf, troupe, { checkFilesDir: bundle.dir });
    if (!result.ok) throw new Error(formatValidationErrors(bundle.name, result));
    for (const { src, base } of stagedAudioFiles(bundle)) {
      staged.push({ bundleName: bundle.name, src, base });
      bytes += statSync(src).size;
    }
  }
  if (bytes > BUDGET) {
    throw new Error(
      `would stage ${bytes} bytes but the data partition budget is ${BUDGET} ` +
        `(${DATA_PARTITION_BYTES} * 0.96) — stage fewer stories`,
    );
  }

  // Wipe the whole stories tree, not just the staged bundles: uploadfs images
  // everything under device/data, so a leftover story from an earlier pack
  // would ship (and bust the budget) without ever being counted.
  rmSync(path.join(outRoot, "stories"), { recursive: true, force: true });
  for (const { bundleName, src, base } of staged) {
    const dest = path.join(outRoot, "stories", bundleName);
    mkdirSync(dest, { recursive: true });
    copyFileSync(src, path.join(dest, base));
  }
  return { files: staged.length, bytes };
}

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run pack:audio -- --bundle <dir> [--bundle <dir>...]",
    options: { bundle: { type: "string", multiple: true, required: true } },
  });
  const { files, bytes } = packAudio(values.bundle);
  console.log(`device/data: ${files} files, ${bytes} bytes (budget ${BUDGET})`);
}

runCli(import.meta.url, main);
