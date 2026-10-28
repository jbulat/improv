// Mix a bundle's whole timeline into a single WAV so a story can be *heard*
// on a computer, no device required (the audio counterpart to preview-art.ts's
// visual contact sheet). Every line clip is placed at its beat's start; every
// sfx cue at (beat start + at_ms). Beat starts are the running sum of
// duration_ms, so the pacing matches what the device would play.
//
//   npm run preview:audio -- --bundle fixtures/knight-and-lonely-dragon
//                            [--out story.wav] [--play]
//
// Output is deterministic and cross-platform (no OS audio needed to *build*
// it). --play is best-effort: it shells to whatever player is on PATH.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decodeWav, encodeWav } from "./lib/wav";
import { assetPath, loadBundle, type Bundle } from "./lib/bundle";
import { ROOT, parseCli, runCli } from "./lib/cli";
import { referencedAudioIds } from "./lib/timeline";

export interface Mix {
  samples: Float32Array; // mono, [-1, 1]
  sampleRate: number;
  durationMs: number;
}

/**
 * Mix the timeline into one mono track. `clips` maps an audio asset id to its
 * decoded mono samples (all at `sampleRate`). Pure: no filesystem, so tests
 * can feed synthetic clips.
 */
export function mixTimeline(
  timeline: { duration_ms: number; line_audio: string | null; sfx: { audio: string; at_ms: number }[] }[],
  clips: Map<string, Float32Array>,
  sampleRate: number,
): Mix {
  const msToFrames = (ms: number) => Math.round((ms / 1000) * sampleRate);

  // Where each beat starts, and where every placed clip ends, so we can size
  // the buffer to the furthest sample even if an sfx tail runs past its beat.
  type Placement = { at: number; samples: Float32Array };
  const placements: Placement[] = [];
  let cursorMs = 0;
  let endFrame = 0;
  const place = (id: string, atMs: number) => {
    const s = clips.get(id);
    if (!s) throw new Error(`no decoded clip for audio id "${id}"`);
    const at = msToFrames(atMs);
    placements.push({ at, samples: s });
    endFrame = Math.max(endFrame, at + s.length);
  };

  for (const beat of timeline) {
    if (beat.line_audio) place(beat.line_audio, cursorMs);
    for (const cue of beat.sfx) place(cue.audio, cursorMs + cue.at_ms);
    cursorMs += beat.duration_ms;
  }
  endFrame = Math.max(endFrame, msToFrames(cursorMs)); // hold the final silence

  const out = new Float32Array(endFrame);
  for (const { at, samples } of placements) {
    for (let i = 0; i < samples.length; i++) {
      const o = at + i;
      let v = out[o] + samples[i];
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      out[o] = v;
    }
  }
  return { samples: out, sampleRate, durationMs: cursorMs };
}

/** Load + decode every clip a bundle's timeline references, then mix. */
export function renderStory(bundle: Bundle): Mix {
  const { perf, dir } = bundle;
  const audioById = new Map(perf.assets.audio.map((a) => [a.id, a]));
  const clips = new Map<string, Float32Array>();
  let sampleRate = 0;

  const referenced = referencedAudioIds(perf.timeline);
  if (referenced.size === 0) {
    throw new Error(`${bundle.name}: the timeline references no audio — nothing to mix`);
  }
  for (const id of referenced) {
    const asset = audioById.get(id);
    if (!asset) throw new Error(`audio id "${id}" referenced by timeline but not in manifest`);
    const wavPath = assetPath(dir, asset.uri);
    if (!existsSync(wavPath)) {
      throw new Error(`missing clip ${wavPath} — run \`npm run gen:audio\`/\`gen:sfx\` first`);
    }
    const { samples, sampleRate: rate } = decodeWav(readFileSync(wavPath));
    if (!sampleRate) sampleRate = rate;
    else if (rate !== sampleRate) {
      throw new Error(`sample rate mismatch: ${id} is ${rate}Hz, expected ${sampleRate}Hz (no resampling)`);
    }
    clips.set(id, samples);
  }
  return mixTimeline(perf.timeline, clips, sampleRate);
}

/** Best-effort: play a WAV through whatever OS player is on PATH. */
function playWav(file: string): boolean {
  const players: [string, string[]][] = [
    ["afplay", [file]], // macOS
    ["paplay", [file]], // PulseAudio
    ["aplay", ["-q", file]], // ALSA
    ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file]],
  ];
  for (const [cmd, cmdArgs] of players) {
    const which = spawnSync("command", ["-v", cmd], { shell: true, encoding: "utf8" });
    if (which.status !== 0) continue;
    try {
      execFileSync(cmd, cmdArgs, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function main(argv: string[]): number | void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run preview:audio -- --bundle <dir> [--out <file.wav>] [--play]",
    options: {
      bundle: { type: "string", required: true },
      out: { type: "string" },
      play: { type: "boolean" },
    },
  });
  const bundle = loadBundle(values.bundle);
  const out = values.out ?? path.join(ROOT, ".audio-preview", `${bundle.name}.wav`);

  const mix = renderStory(bundle);
  const wav = encodeWav(mix.samples, mix.sampleRate);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, wav);
  const secs = (mix.durationMs / 1000).toFixed(1);
  console.log(`${out} — ${secs}s, ${bundle.perf.timeline.length} beats @ ${mix.sampleRate}Hz`);

  if (values.play && !playWav(out)) {
    console.error("no audio player found on PATH (tried afplay/paplay/aplay/ffplay) — open the WAV manually");
    return 1;
  }
}

runCli(import.meta.url, main);
