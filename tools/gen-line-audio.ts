// Renders one WAV per spoken line with Kokoro-82M (tools/kokoro-tts.py;
// install it with `npm run setup:kokoro`), then (with --write-durations)
// patches measured durations back into the fixture:
//   - every assets.audio duration_ms := measured from its WAV (lines AND sfx)
//   - every speaking beat duration_ms := clip + SPEAK_TAIL_MS
// Silent beats (line_audio: null) keep their hand-authored duration.
// Run AFTER gen-sfx so sfx files exist for the patch step.
//
// Hand-authored sfx cue offsets are never patched, so each regenerated clip is
// compared with the one it replaced and a material shift on a beat with cues
// is reported (see tools/lib/cue-drift.ts).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeWav, encodeWav, readWavFormat, wavDurationMs } from "./lib/wav";
import { normalizeToTarget, trimQuiet } from "./lib/loudness";
import {
  DELIVERY_CHANNELS,
  DELIVERY_SAMPLE_RATE,
  PEAK_CEILING_DB,
  TARGET_RMS_DB,
  assertDeliveryFormat,
} from "./lib/delivery-format";
import { cueDrifts, formatCueDrift } from "./lib/cue-drift";
import { assetPath, loadBundle } from "./lib/bundle";
import { ROOT, parseCli, runCli } from "./lib/cli";
import { assertKokoroReady, kokoroPython } from "./lib/kokoro";

const SPEAK_TAIL_MS = 300;
// The quiet around each line that is cut away (see trimQuiet). 20 dB under the
// speech level keeps a soft final consonant; the pad keeps its decay.
const TRIM = { belowSpeechDb: 20, padMs: 80, fadeMs: 15 };
// Model load plus every line of the longest story is well under this.
const KOKORO_TIMEOUT_MS = 600_000;

// Every line lands at one speech level, so no actor is quieter than another.
// Each voice renders at its own level, and the device has no volume left to
// compensate with — its master is already 255. Pure gain, capped by the
// ceiling: a clip whose peaks are already near full scale falls short of
// target and is reported, rather than being compressed into place. The target
// and the ceiling come from tools/lib/delivery-format.ts.

// actor signature voice id (from troupe.json) -> Kokoro voice, speaking speed
// (1 = normal) and pitch shift. The humans are British stage voices: a touch
// slow, with longer pauses between sentences. Rosa and the animals are
// American. Miss Moon reads US phonemes bent toward a Southern drawl (see
// tools/kokoro-tts.py), since Kokoro has no Southern voice of its own. Speed is
// Kokoro's own; the pitch shift and any filter run in ffmpeg afterwards, so
// they change the pitch without changing the length.
interface KokoroVoice {
  voice: string;
  speed: number;
  semitones?: number;
  filter?: string;
  /** Seconds of silence between sentences. Kokoro's default is 0.25. */
  pause?: number;
  accent?: "southern";
  /** Overrides TRIM.belowSpeechDb, for a voice whose breath noise sits close
   *  under its speech. */
  trimBelowDb?: number;
}
const GRUFF = "bass=g=6:f=140,volume=5dB,asoftclip=type=tanh,volume=-5dB,lowpass=f=5500";
export const KOKORO_VOICES: Record<string, KokoroVoice> = {
  tts_moon_host: { voice: "af_heart", speed: 0.9, pause: 0.4, accent: "southern" },
  tts_low_gruff: { voice: "bm_george", speed: 0.9, semitones: -2, pause: 0.45 },
  // bm_fable trails 600-800 ms of breath only 17-20 dB under its speech.
  tts_mid_earnest: { voice: "bm_fable", speed: 0.95, pause: 0.4, trimBelowDb: 15 },
  tts_mid_warm: { voice: "bf_emma", speed: 0.95, pause: 0.4 },
  tts_bright_young: { voice: "af_sky", speed: 1.05, semitones: 3, pause: 0.35 },
  tts_high_quick: { voice: "af_bella", speed: 1.1, semitones: 3 },
  tts_low_rumble: { voice: "am_onyx", speed: 0.88, semitones: -4, filter: GRUFF },
};

interface LineJob {
  id: string;
  text: string;
  voiceId: string;
}

function kokoroVoice(voiceId: string): KokoroVoice {
  const spec = KOKORO_VOICES[voiceId];
  if (!spec) throw new Error(`no Kokoro mapping for voice id "${voiceId}" — add it to KOKORO_VOICES`);
  return spec;
}

/** Renders every job in one Kokoro process, each to `<tmp>/<id>.raw.wav`. */
function renderKokoro(jobs: LineJob[], tmp: string): void {
  const input = jobs.map((j) => {
    const v = kokoroVoice(j.voiceId);
    return {
      text: j.text,
      voice: v.voice,
      speed: v.speed,
      // A British voice reads with British phonemes.
      lang: v.voice.startsWith("b") ? "en-gb" : "en-us",
      pause: v.pause ?? 0.25,
      accent: v.accent ?? null,
      out: path.join(tmp, `${j.id}.raw.wav`),
    };
  });
  execFileSync(kokoroPython(), [path.join(ROOT, "tools/kokoro-tts.py")], {
    input: JSON.stringify(input),
    stdio: ["pipe", "ignore", "inherit"],
    timeout: KOKORO_TIMEOUT_MS,
  });
}

/** One Kokoro clip to the delivery format, with its pitch shift and filter.
 *  ffmpeg is the only resampler in the pipeline, and it runs here, at the
 *  moment a clip is produced. Nothing downstream ever converts a rate. */
function convertClip(job: LineJob, tmp: string, wavPath: string): void {
  const v = kokoroVoice(job.voiceId);
  const raw = path.join(tmp, `${job.id}.raw.wav`);
  const rate = readWavFormat(readFileSync(raw)).sampleRate;
  const ratio = 2 ** ((v.semitones ?? 0) / 12);
  // Play faster to raise the pitch, then stretch back to the original length.
  const filters = [`asetrate=${rate * ratio}`, `aresample=${rate}`, `atempo=${1 / ratio}`];
  if (v.filter) filters.push(v.filter);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    raw,
    "-af",
    filters.join(","),
    "-ar",
    String(DELIVERY_SAMPLE_RATE),
    "-ac",
    String(DELIVERY_CHANNELS),
    "-c:a",
    "pcm_s16le",
    "-map_metadata",
    "-1",
    "-fflags",
    "+bitexact",
    wavPath,
  ]);
}

function describeVoice(voiceId: string): string {
  const v = kokoroVoice(voiceId);
  const semis = v.semitones ? ` ${v.semitones > 0 ? "+" : ""}${v.semitones}st` : "";
  return `${v.voice}×${v.speed}${semis}${v.filter ? " gruff" : ""}${v.accent ? ` ${v.accent}` : ""}`;
}

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run gen:audio -- --bundle <dir> [--write-durations]",
    options: {
      bundle: { type: "string", required: true },
      "write-durations": { type: "boolean" },
    },
  });
  const writeDurations = values["write-durations"];
  const bundle = loadBundle(values.bundle);
  const { perf, perfPath, dir: bundleDir, spokenOverrides } = bundle;
  const voiceByCharacter = new Map(perf.cast.map((c) => [c.character_id, c.voice]));
  const audioById = new Map(perf.assets.audio.map((a) => [a.id, a]));
  // audio id -> clip length, measured on the file this run replaced and on the
  // file it wrote. A clip with no entry in `before` is new, so it has no earlier
  // length that cues could have been written against.
  const clipMsBefore = new Map<string, number>();
  const clipMsAfter = new Map<string, number>();

  const jobs: LineJob[] = [];
  for (const beat of perf.timeline) {
    if (beat.line_audio === null) continue;
    const asset = audioById.get(beat.line_audio);
    if (!asset) throw new Error(`beat ${beat.index}: line_audio "${beat.line_audio}" not in manifest`);
    const voiceId = voiceByCharacter.get(beat.character_id);
    if (!voiceId) throw new Error(`beat ${beat.index}: character "${beat.character_id}" not in cast`);
    kokoroVoice(voiceId);
    jobs.push({ id: asset.id, text: spokenOverrides[asset.id] ?? beat.text, voiceId });
  }
  assertKokoroReady();
  const tmp = mkdtempSync(path.join(os.tmpdir(), "improv-tts-"));
  renderKokoro(jobs, tmp);

  for (const job of jobs) {
    const asset = audioById.get(job.id)!;
    const wavPath = assetPath(bundleDir, asset.uri);
    mkdirSync(path.dirname(wavPath), { recursive: true });
    // A prior clip too damaged to measure is simply no baseline; re-rendering
    // over it is the fix for that, and must not be blocked by it.
    if (existsSync(wavPath)) {
      try {
        clipMsBefore.set(asset.id, wavDurationMs(readFileSync(wavPath)));
      } catch {
        /* unreadable or not a WAV — nothing to compare against */
      }
    }
    convertClip(job, tmp, wavPath);

    const raw = readFileSync(wavPath);
    assertDeliveryFormat(raw, asset.id);
    const trimDb = kokoroVoice(job.voiceId).trimBelowDb ?? TRIM.belowSpeechDb;
    const trimmed = trimQuiet(decodeWav(raw).samples, DELIVERY_SAMPLE_RATE, {
      ...TRIM,
      belowSpeechDb: trimDb,
    });
    const { samples, report } = normalizeToTarget(trimmed, {
      targetRmsDb: TARGET_RMS_DB,
      peakCeilingDb: PEAK_CEILING_DB,
    });
    const clip = encodeWav(samples, DELIVERY_SAMPLE_RATE);
    writeFileSync(wavPath, clip);
    clipMsAfter.set(asset.id, wavDurationMs(clip));

    const level =
      `${report.rmsDbBefore.toFixed(1)} -> ${report.rmsDbAfter.toFixed(1)} dBFS ` +
      `(${report.gainDb >= 0 ? "+" : ""}${report.gainDb.toFixed(1)} dB)`;
    console.log(`${asset.id}: ${describeVoice(job.voiceId)} — "${job.text}"`);
    console.log(`  level ${level}`);
    if (report.ceilingLimited) {
      console.warn(
        `  ! ${asset.id} is peak-limited: gain capped at the ${PEAK_CEILING_DB} dBFS ceiling, ` +
          `so it sits ${(TARGET_RMS_DB - report.rmsDbAfter).toFixed(1)} dB under the ${TARGET_RMS_DB} dBFS target`,
      );
    }
  }

  // Reported whether or not durations are being written: the cues went stale the
  // moment the WAV changed, and --write-durations only decides whether the
  // manifest keeps up with it.
  const drifts = cueDrifts(perf.timeline, clipMsBefore, clipMsAfter);
  if (drifts.length > 0) {
    const subject = drifts.length === 1 ? "beat carries" : "beats carry";
    console.warn(`\n! ${drifts.length} ${subject} sfx cues authored against a clip that moved:`);
    for (const d of drifts) for (const line of formatCueDrift(d)) console.warn(line);
    console.warn("");
  }

  // Without --write-durations the manifest keeps the lengths it was committed
  // with, which may have been measured on another machine. A clip that renders to a different
  // length here plays against a timeline that no longer fits it, so say which.
  if (!writeDurations) {
    const off = [...clipMsAfter]
      .map(([id, ms]) => ({ id, ms, manifest: audioById.get(id)!.duration_ms }))
      .filter((c) => c.ms !== c.manifest);
    if (off.length > 0) {
      console.warn(`\n! ${off.length} clip(s) differ from the length in performance.json:`);
      for (const c of off) {
        const d = c.ms - c.manifest;
        console.warn(
          `  ! ${c.id}: ${c.manifest}ms in the manifest, ${c.ms}ms rendered (${d > 0 ? "+" : ""}${d}ms)`,
        );
      }
      console.warn("  Re-run with --write-durations to accept the new lengths.\n");
    }
  }

  if (writeDurations) {
    for (const a of perf.assets.audio) {
      if (a.uri.includes("://")) continue;
      a.duration_ms = wavDurationMs(readFileSync(assetPath(bundleDir, a.uri)));
    }
    for (const beat of perf.timeline) {
      if (beat.line_audio === null) continue;
      const a = audioById.get(beat.line_audio);
      if (a) beat.duration_ms = a.duration_ms + SPEAK_TAIL_MS;
    }
    writeFileSync(perfPath, JSON.stringify(perf, null, 2) + "\n");
    console.log(`patched measured durations into ${perfPath}`);
  }
}

runCli(import.meta.url, main);
