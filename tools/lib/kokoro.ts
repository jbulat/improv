// Where Kokoro-82M lives, and whether it is ready. `npm run setup:kokoro`
// installs it; gen:audio and gen:audio:all check here before they render.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function kokoroHome(): string {
  return process.env.KOKORO_HOME ?? path.join(os.homedir(), ".local/share/kokoro");
}

export function kokoroPython(): string {
  return path.join(kokoroHome(), "venv/bin/python");
}

/** Throws, naming the fix, unless Kokoro and ffmpeg are both installed. */
export function assertKokoroReady(): void {
  const home = kokoroHome();
  const files = [kokoroPython(), path.join(home, "kokoro-v1.0.onnx"), path.join(home, "voices-v1.0.bin")];
  if (!files.every((f) => existsSync(f))) {
    throw new Error(`Kokoro is not installed in ${home}. Run npm run setup:kokoro`);
  }
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error) {
    throw new Error("gen:audio needs ffmpeg, which is not on PATH. Install it with: brew install ffmpeg");
  }
}
