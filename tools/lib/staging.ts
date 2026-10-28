// The staged-audio file set shared by pack:audio and serve:bundle, so the USB
// image and the OTA manifest can never drift.
import path from "node:path";
import { assetPath, type Bundle } from "./bundle";

export interface StagedFile {
  src: string; // the rendered WAV on disk
  base: string; // its flat name under stories/<bundle>/ on-device
}

/** Every assets.audio entry, sorted by id. */
export function stagedAudioFiles(bundle: Bundle): StagedFile[] {
  return [...bundle.perf.assets.audio]
    .sort((x, y) => x.id.localeCompare(y.id))
    .map((a) => ({ src: assetPath(bundle.dir, a.uri), base: path.basename(a.uri) }));
}
