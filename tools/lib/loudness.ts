// Speech-level measurement and per-clip normalization.
//
// Each TTS voice renders at its own level. Under macOS `say`, which rendered the
// clips before Kokoro, the low/gruff voices landed 4-6 dB under the host's in
// one bundle, which on the StickS3's speaker is the difference between "heard"
// and "leaned in for".
// The device has no volume left to give (master boots at 255), so evening the
// clips out at build time is the only lever.

import { SPEECH_FLOOR_LINEAR } from "./delivery-format";

/** Below this is room tone between phrases, not speech. The number itself
 *  belongs to the delivery format, not to this module. */
export const SPEECH_FLOOR = SPEECH_FLOOR_LINEAR;

const toDb = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Loudest sample, in dBFS. -Infinity for pure silence. */
export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return toDb(peak);
}

/**
 * RMS in dBFS over samples above SPEECH_FLOOR. Gating matters: a clip with long
 * pauses has the same speech level as one without, but a much lower whole-file
 * RMS, and it is the speech we are matching between actors.
 */
export function speechRmsDb(samples: Float32Array): number {
  let sumSquares = 0;
  let counted = 0;
  for (const s of samples) {
    if (Math.abs(s) > SPEECH_FLOOR) {
      sumSquares += s * s;
      counted++;
    }
  }
  return counted > 0 ? toDb(Math.sqrt(sumSquares / counted)) : -Infinity;
}

export interface TrimOptions {
  /** A 10 ms frame this far under the clip's speech level counts as quiet. */
  belowSpeechDb: number;
  /** Quiet kept before the first loud frame and after the last one. */
  padMs: number;
  /** Fade applied at each new edge, so the cut does not click. */
  fadeMs: number;
}

/**
 * Cut the quiet lead-in and tail around the speech. The player flaps the mouth
 * for the clip's whole length, so breath or hiss after the last word reads as
 * talking. Some voices leave over half a second of it. Only the ends are cut;
 * a pause between words stays. A clip with no frame above the threshold comes
 * back unchanged.
 */
export function trimQuiet(samples: Float32Array, sampleRate: number, opts: TrimOptions): Float32Array {
  const frame = Math.round(sampleRate / 100);
  const threshold = speechRmsDb(samples) - opts.belowSpeechDb;
  const loud: number[] = [];
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(start + frame, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    if (toDb(Math.sqrt(sum / (end - start))) > threshold) loud.push(start);
  }
  if (loud.length === 0) return samples;
  const pad = Math.round((opts.padMs * sampleRate) / 1000);
  const from = Math.max(0, loud[0] - pad);
  const to = Math.min(samples.length, loud[loud.length - 1] + frame + pad);
  const out = samples.slice(from, to);
  const fade = Math.min(Math.round((opts.fadeMs * sampleRate) / 1000), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

export interface NormalizeOptions {
  /** Speech RMS every clip aims for, in dBFS. */
  targetRmsDb: number;
  /** Output peak is never allowed above this, in dBFS. */
  peakCeilingDb: number;
}

export interface NormalizeReport {
  gainDb: number;
  rmsDbBefore: number;
  rmsDbAfter: number;
  peakDbAfter: number;
  /** The ceiling capped the gain, so the clip sits below targetRmsDb. */
  ceilingLimited: boolean;
}

export interface NormalizeResult {
  samples: Float32Array;
  report: NormalizeReport;
}

/**
 * Scale `samples` toward `targetRmsDb`, never letting the peak pass
 * `peakCeilingDb`. Pure gain — no compression — so a clip whose peaks are
 * already near full scale falls short of target rather than being squashed,
 * and says so via `ceilingLimited`.
 */
export function normalizeToTarget(
  samples: Float32Array,
  { targetRmsDb, peakCeilingDb }: NormalizeOptions,
): NormalizeResult {
  const rmsDbBefore = speechRmsDb(samples);
  const peakDbBefore = peakDb(samples);

  // Silence has no level to correct toward; leave it exactly as it is.
  if (!Number.isFinite(rmsDbBefore) || !Number.isFinite(peakDbBefore)) {
    return {
      samples,
      report: {
        gainDb: 0,
        rmsDbBefore,
        rmsDbAfter: rmsDbBefore,
        peakDbAfter: peakDbBefore,
        ceilingLimited: false,
      },
    };
  }

  const wantedDb = targetRmsDb - rmsDbBefore;
  const headroomDb = peakCeilingDb - peakDbBefore;
  const gainDb = Math.min(wantedDb, headroomDb);
  const ceilingLimited = headroomDb < wantedDb;

  const scale = 10 ** (gainDb / 20);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * scale;

  return {
    samples: out,
    report: {
      gainDb,
      rmsDbBefore,
      rmsDbAfter: rmsDbBefore + gainDb,
      peakDbAfter: peakDbBefore + gainDb,
      ceilingLimited,
    },
  };
}
