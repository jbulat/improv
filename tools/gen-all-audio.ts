// Renders the spoken line clips of every bundle with Kokoro: gen:audio's main,
// once per bundle, in this process. Run it after a change to a voice, so every
// story picks the change up.
//
//   npm run gen:audio:all                         keep the committed lengths
//   npm run gen:audio:all -- --write-durations    accept the lengths rendered here
import { bundleDirs } from "./lib/bundle";
import { parseCli, reportError, runCli } from "./lib/cli";
import { assertKokoroReady } from "./lib/kokoro";
import { main as genLineAudio } from "./gen-line-audio";

export function main(argv: string[]): number | void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run gen:audio:all -- [--write-durations]",
    options: { "write-durations": { type: "boolean" } },
  });
  // Checked once here, so a missing install is one message and not one per bundle.
  try {
    assertKokoroReady();
  } catch (err) {
    reportError(err);
    return 1;
  }

  const passOn = values["write-durations"] ? ["--write-durations"] : [];
  const failed: string[] = [];
  for (const dir of bundleDirs()) {
    console.log(`\n== ${dir}`);
    // One bundle's failure is reported and the rest still render.
    try {
      genLineAudio(["--bundle", dir, ...passOn]);
    } catch (err) {
      reportError(err);
      failed.push(dir);
    }
  }
  if (failed.length > 0) {
    console.error(`\ngen:audio failed for: ${failed.join(", ")}`);
    return 1;
  }
}

runCli(import.meta.url, main);
