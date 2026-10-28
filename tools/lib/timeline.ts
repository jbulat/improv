import type { Beat } from "./types";

/** Every audio asset id the timeline references (line clips + sfx cues). */
export function referencedAudioIds(timeline: Pick<Beat, "line_audio" | "sfx">[]): Set<string> {
  const ids = new Set<string>();
  for (const beat of timeline) {
    if (beat.line_audio) ids.add(beat.line_audio);
    for (const cue of beat.sfx) ids.add(cue.audio);
  }
  return ids;
}
