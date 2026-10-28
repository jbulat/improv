// The delivery audio format: what every clip a device plays must be. Each of
// its numbers (rate, channels, bit depth, loudness targets) lives here and
// nowhere else; tests/delivery-format.test.ts fails if a second copy appears.
import { readWavFormat } from "./wav";

/** Hz. Decided by ear on the device -- the floor of what is acceptable, not a
 *  target to optimise below. 12 kHz only as a recorded exception; 8 kHz never. */
export const DELIVERY_SAMPLE_RATE = 16000;

/** Mono. The device's WavReader refuses anything else before a sample plays. */
export const DELIVERY_CHANNELS = 1;

/** Bits per sample. Also enforced by the device's reader. */
export const DELIVERY_BITS_PER_SAMPLE = 16;

/** `fmt` audioFormat for uncompressed PCM. Also enforced by the device's reader. */
export const DELIVERY_AUDIO_FORMAT = 1;

/** dBFS. Gated speech RMS every spoken line aims for.
 *  Lines only -- sfx are never held to it. See PEAK_CEILING_DB. */
export const TARGET_RMS_DB = -14;

/** dBFS. Applies to every clip, line and sfx alike: it is a clipping guard and
 *  belongs to the format rather than to speech. */
export const PEAK_CEILING_DB = -1;

/** dBFS. The RMS gate: quieter than this is room tone between phrases, not
 *  speech, and is excluded from the measurement. */
export const SPEECH_FLOOR_DB = -40;

/** The gate as a linear magnitude. Derived, so the gate is one number and not
 *  two that can disagree. */
export const SPEECH_FLOOR_LINEAR = 10 ** (SPEECH_FLOOR_DB / 20);

export interface FormatViolation {
  field: "audioFormat" | "channels" | "sampleRate" | "bitsPerSample";
  expected: number;
  actual: number;
}

/**
 * Every way `buf`'s header departs from the delivery format. Empty means it
 * conforms. Reports all four rather than the first, because a clip that is
 * wrong in two ways is worth seeing whole.
 *
 * Header only. The peak ceiling is a property of the sample data, so it is
 * measured with `peakDb` from ./loudness against `PEAK_CEILING_DB` -- keeping
 * this module free of any dependency but the RIFF walker.
 */
export function deliveryFormatViolations(buf: Buffer): FormatViolation[] {
  const fmt = readWavFormat(buf);
  const checks: FormatViolation[] = [
    { field: "audioFormat", expected: DELIVERY_AUDIO_FORMAT, actual: fmt.audioFormat },
    { field: "channels", expected: DELIVERY_CHANNELS, actual: fmt.channels },
    { field: "sampleRate", expected: DELIVERY_SAMPLE_RATE, actual: fmt.sampleRate },
    { field: "bitsPerSample", expected: DELIVERY_BITS_PER_SAMPLE, actual: fmt.bitsPerSample },
  ];
  return checks.filter((c) => c.actual !== c.expected);
}

export function formatViolationMessage(label: string, violations: FormatViolation[]): string {
  const parts = violations.map((v) => `${v.field} is ${v.actual}, expected ${v.expected}`);
  return `${label}: off the delivery format -- ${parts.join("; ")}`;
}

/** Throw unless `buf` is the delivery format. `label` names the clip. */
export function assertDeliveryFormat(buf: Buffer, label: string): void {
  const violations = deliveryFormatViolations(buf);
  if (violations.length > 0) throw new Error(formatViolationMessage(label, violations));
}
