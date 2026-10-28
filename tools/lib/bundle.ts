// The only code that knows a story bundle's shape. A bundle is a directory
// holding performance.json, an audio/ dir of rendered clips, and an optional
// spoken-overrides.json (audio id -> the text TTS should say, when it differs
// from the beat's display text).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Performance } from "./types";

export interface Bundle {
  dir: string;
  name: string;
  perfPath: string;
  audioDir: string;
  perf: Performance;
  spokenOverrides: Record<string, string>;
}

/** True when a scheme-less asset uri names a path inside the bundle directory. */
export function staysInBundle(uri: string): boolean {
  if (uri.includes("\\") || path.posix.isAbsolute(uri)) return false;
  return !path.posix.normalize(uri).split("/").includes("..");
}

/** The on-disk path of a bundle-relative asset uri. Throws if it would leave the bundle. */
export function assetPath(bundleDir: string, uri: string): string {
  if (!staysInBundle(uri)) throw new Error(`asset uri "${uri}" is not a path inside ${bundleDir}`);
  return path.join(bundleDir, uri);
}

export function loadBundle(dir: string): Bundle {
  const perfPath = path.join(dir, "performance.json");
  if (!existsSync(perfPath)) throw new Error(`no performance.json under "${dir}"`);
  const perf = JSON.parse(readFileSync(perfPath, "utf8")) as Performance;
  const ovPath = path.join(dir, "spoken-overrides.json");
  const spokenOverrides = existsSync(ovPath)
    ? (JSON.parse(readFileSync(ovPath, "utf8")) as Record<string, string>)
    : {};
  return {
    dir,
    name: path.basename(dir),
    perfPath,
    audioDir: path.join(dir, "audio"),
    perf,
    spokenOverrides,
  };
}

/** Every story bundle under `root`, sorted. Excludes fixtures/invalid. */
export function bundleDirs(root = "fixtures"): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "invalid")
    .map((e) => path.join(root, e.name))
    .filter((d) => existsSync(path.join(d, "performance.json")))
    .sort();
}
