// Mixes a simulator run's playback events down to one WAV. SimAudio is the
// authoritative model of what is sounding, so the play list is taken as is,
// not re-derived from the timeline.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NARRATION_CHANNEL, SFX_CHANNEL_GAIN, type PlayEvent } from "./sim-audio";
import { decodeWav, encodeWav } from "./wav";
import { DELIVERY_SAMPLE_RATE } from "./delivery-format";

/** The mix's default rate, used only when a trace has no plays at all — there
 *  is no first clip to adopt a rate from. With plays, the mix adopts the first
 *  clip's rate and throws on any clip that differs; it never converts. The
 *  number is the delivery format's, not this module's. */
const DEFAULT_RATE = DELIVERY_SAMPLE_RATE;

export interface MixResult {
  wav: Buffer;
  sampleRate: number;
  frames: number;
  /** Samples that exceeded +/-1 before encoding. encodeWav clamps silently,
   *  so without this a distorting mix would ship sounding rasped with nothing
   *  anywhere saying why. */
  clipped: number;
}

/**
 * Mix `plays` into a single mono WAV of `endMs`.
 *
 * `audioRoot` is the simulator's session directory, not the bundle: PlayEvent
 * carries the device-relative path the app asked for ("stories/<name>/x.wav"),
 * which SimAudio resolves against its own root.
 */
export function mixTrace(plays: PlayEvent[], opts: { audioRoot: string; endMs: number }): MixResult {
  if (!Number.isFinite(opts.endMs) || opts.endMs <= 0) {
    throw new Error(`mixTrace: endMs must be finite and positive, got ${opts.endMs}`);
  }

  const decoded = new Map<string, { samples: Float32Array; sampleRate: number }>();
  let rate = 0;
  for (const e of plays) {
    if (decoded.has(e.path)) continue;
    const abs = path.resolve(opts.audioRoot, e.path);
    if (!existsSync(abs)) throw new Error(`mixTrace: clip not found: ${e.path} (under ${opts.audioRoot})`);
    const clip = decodeWav(readFileSync(abs));
    // The mix has one rate and no resampler: it adopts the first clip's rate
    // and rejects any other, rather than pitch-shift a clip.
    if (rate === 0) rate = clip.sampleRate;
    else if (clip.sampleRate !== rate) {
      throw new Error(
        `mixTrace: ${e.path} is ${clip.sampleRate} Hz but the mix is ${rate} Hz (no resampler)`,
      );
    }
    decoded.set(e.path, clip);
  }
  if (rate === 0) rate = DEFAULT_RATE;

  const frames = Math.round((opts.endMs * rate) / 1000);
  const mix = new Float32Array(frames);

  // On the device S.line_start calls audio.stop(0) before the next line, so a
  // narration clip that outlasts its beat is cut. SimTrace.stops has no
  // times, but that stop comes right before the next channel-0 play, so the
  // play marks the cut (endMs covers the final stop). A parallel array, since
  // the events belong to the caller's SimTrace.
  const cutAtMs = new Array<number | undefined>(plays.length);
  const nextOnChannel = new Map<number, number>();
  for (let i = plays.length - 1; i >= 0; i--) {
    cutAtMs[i] = nextOnChannel.get(plays[i].channel);
    nextOnChannel.set(plays[i].channel, plays[i].atMs);
  }

  for (const [i, e] of plays.entries()) {
    const clip = decoded.get(e.path)!;
    const gain = e.channel === NARRATION_CHANNEL ? 1 : SFX_CHANNEL_GAIN;
    const cut = cutAtMs[i];
    const start = Math.round((e.atMs * rate) / 1000);
    const skip = Math.round((e.offsetMs * rate) / 1000);
    const endFrame = Math.min(
      frames,
      cut === undefined ? frames : Math.round((cut * rate) / 1000),
      start + Math.max(0, clip.samples.length - skip),
    );
    for (let f = Math.max(0, start); f < endFrame; f++) {
      const src = f - start + skip;
      if (src < 0 || src >= clip.samples.length) continue;
      mix[f] += clip.samples[src] * gain;
    }
  }

  let clipped = 0;
  for (let i = 0; i < mix.length; i++) if (mix[i] > 1 || mix[i] < -1) clipped++;

  return { wav: encodeWav(mix, rate), sampleRate: rate, frames, clipped };
}
