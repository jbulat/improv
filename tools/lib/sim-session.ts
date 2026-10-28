// The simulator's stand-in for the device filesystem: <root>/<deviceId>/stories/
// laid out exactly as LittleFS is, so a bundle's clips sit at the
// stories/<name>/<id>.wav paths gen-performance-data bakes into audio_root.
// The fixture WAVs are symlinked, so an edited fixture plays without restaging.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { loadBundle } from "./bundle";
import { loadTroupe } from "./troupe";
import { stagedAudioFiles } from "./staging";
import { formatValidationErrors, validatePerformance } from "./validator";

export interface Session {
  dir: string;
  deviceId: string;
  storiesDir: string;
}

export interface StagedBundle {
  name: string;
  storyDir: string;
  /** Device-relative prefix, matching the app's baked audio_root. */
  audioRoot: string;
  files: { name: string; src: string; bytes: number }[];
}

/** A stable `sim-xxxxxxxx` derived from the session path. */
export function deviceIdFor(sessionDir: string): string {
  const key = path.resolve(sessionDir);
  return "sim-" + createHash("sha1").update(key).digest("hex").slice(0, 8);
}

export function openSession(root: string, deviceId?: string): Session {
  const id = deviceId ?? deviceIdFor(root);
  const dir = path.join(root, id);
  const storiesDir = path.join(dir, "stories");
  mkdirSync(storiesDir, { recursive: true });
  return { dir, deviceId: id, storiesDir };
}

/**
 * A safe single-component story name to stage a bundle under. `bundle.name`
 * is the basename of the raw input, so `--bundle .` would give "."; resolving
 * first gives the real directory name. Anything still unsafe is refused.
 */
function safeStoryName(bundleDir: string): string {
  const resolved = path.resolve(bundleDir);
  const name = path.basename(resolved);
  if (!name || name === "." || name === ".." || name.includes(path.sep)) {
    throw new Error(
      `stageBundle: bundle dir "${bundleDir}" resolves to an unsafe story name ` +
        `("${name}" from "${resolved}"); refusing to stage into the session's stories/ tree`,
    );
  }
  return name;
}

/**
 * Link a validated bundle's declared audio into the session tree. Throws on an
 * invalid bundle: a simulator that silently cannot play is the problem this
 * whole tool exists to fix.
 */
export function stageBundle(session: Session, bundleDir: string): StagedBundle {
  const bundle = loadBundle(bundleDir);
  const result = validatePerformance(bundle.perf, loadTroupe(), { checkFilesDir: bundle.dir });
  if (!result.ok) throw new Error(formatValidationErrors(bundle.name, result));

  const storyName = safeStoryName(bundleDir);
  const storyDir = path.join(session.storiesDir, storyName);
  rmSync(storyDir, { recursive: true, force: true });
  mkdirSync(storyDir, { recursive: true });

  // The staged set is the shared rule, not a local one: pack:audio (USB) and
  // serve:bundle (OTA) resolve the same list, so the sim plays exactly the
  // files the device would have received.
  const files = stagedAudioFiles(bundle).map(({ src, base }) => {
    const abs = path.resolve(src);
    symlinkSync(abs, path.join(storyDir, base));
    return { name: base, src: abs, bytes: statSync(abs).size };
  });

  return { name: storyName, storyDir, audioRoot: `stories/${storyName}`, files };
}
