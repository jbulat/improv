// Cue drift: a regenerated line clip whose length moved, on a beat with sfx
// cues authored against the old length. Nothing rewrites the hand-authored
// `sfx[].at_ms` offsets, and SFX_PAST_END fires only past the end of the beat.
// The offsets are reported, never rescaled: a new voice does not stretch a clip
// uniformly (syllables shrink more than pauses), so the author re-checks by ear.
import type { Beat, SfxCue } from "./types";

/**
 * A shift smaller than this cannot push any cue more than this far out of
 * place, and matches the validator's own AUDIO_DURATION_MISMATCH tolerance.
 */
export const DRIFT_FLOOR_MS = 100;

/**
 * Short clips hold their cues in proportionally tighter quarters, so a shift
 * this large relative to the clip is worth reporting even under the floor.
 */
export const DRIFT_RATIO = 0.05;

export interface CueDrift {
  beatIndex: number;
  audioId: string;
  beforeMs: number;
  afterMs: number;
  /** Every cue on the beat: all of them were authored against `beforeMs`. */
  cues: SfxCue[];
}

/** Did this clip's length move far enough to invalidate a cue authored on it? */
export function isMaterialDrift(beforeMs: number, afterMs: number): boolean {
  const delta = Math.abs(afterMs - beforeMs);
  return delta >= DRIFT_FLOOR_MS || delta >= beforeMs * DRIFT_RATIO;
}

/**
 * Beats whose line clip changed length materially AND carry sfx cues.
 *
 * `before` and `after` map audio id -> clip length in ms. An id missing from
 * `before` is a clip that did not exist until this run, so there is no earlier
 * length its cues could have been authored against and nothing to report.
 */
export function cueDrifts(
  timeline: Beat[],
  before: Map<string, number>,
  after: Map<string, number>,
): CueDrift[] {
  const drifts: CueDrift[] = [];
  for (const beat of timeline) {
    if (beat.line_audio === null || beat.sfx.length === 0) continue;
    const beforeMs = before.get(beat.line_audio);
    const afterMs = after.get(beat.line_audio);
    if (beforeMs === undefined || afterMs === undefined) continue;
    if (!isMaterialDrift(beforeMs, afterMs)) continue;
    drifts.push({
      beatIndex: beat.index,
      audioId: beat.line_audio,
      beforeMs,
      afterMs,
      cues: beat.sfx,
    });
  }
  return drifts;
}

/**
 * The warning as printed lines, one cue per line, each carrying the offset and
 * where it now sits in the new clip — the two numbers an author needs to judge
 * whether the cue still lands where they meant it to.
 */
export function formatCueDrift(d: CueDrift): string[] {
  const delta = d.afterMs - d.beforeMs;
  const sign = delta >= 0 ? "+" : "";
  const pct = ((delta / d.beforeMs) * 100).toFixed(1);
  const cueWord = d.cues.length === 1 ? "cue" : "cues";
  const lines = [
    `  ! ${d.audioId} (beat ${d.beatIndex}) changed ${d.beforeMs}ms -> ${d.afterMs}ms ` +
      `(${sign}${delta}ms, ${sign}${pct}%) and carries ${d.cues.length} sfx ${cueWord}:`,
  ];
  for (const c of d.cues) {
    const left = d.afterMs - c.at_ms;
    const where =
      left > 0
        ? `now ${left}ms from the end of the clip, was ${d.beforeMs - c.at_ms}ms`
        : `now ${-left}ms PAST the end of the clip`;
    lines.push(`      ${c.audio} at ${c.at_ms}ms — ${where}`);
  }
  lines.push(
    "    cue offsets are not rescaled — re-check them against the new clip by ear " +
      "(`npm run preview:audio`) and re-author any that moved off their mark",
  );
  return lines;
}
