// Synthesizes the troupe's lo-fi chiptune sfx at the delivery format
// (tools/lib/delivery-format.ts). Every id in troupe.json's sfx_vocabulary has
// a synth here. Deterministic: a seeded PRNG makes re-runs byte-identical.
//
// A clip over the peak ceiling fails the run. sfx are never held to the speech
// loudness target, and no gain is applied: their relative levels are art
// direction.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeWav } from "./lib/wav";
import { peakDb } from "./lib/loudness";
import { DELIVERY_SAMPLE_RATE, PEAK_CEILING_DB } from "./lib/delivery-format";
import { assetPath, loadBundle } from "./lib/bundle";
import { parseCli, runCli } from "./lib/cli";

const RATE = DELIVERY_SAMPLE_RATE;

const seconds = (n: number) => Math.floor(n * RATE);

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One-pole lowpass coefficient for a given cutoff frequency
const lpAlpha = (cutoffHz: number) => 1 - Math.exp((-2 * Math.PI * cutoffHz) / RATE);

function whoosh(): Float32Array {
  // Noise through a lowpass sweeping up 200 -> 4000 Hz, sine-shaped envelope
  const n = seconds(0.7);
  const out = new Float32Array(n);
  const rnd = mulberry32(1);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    lp += lpAlpha(200 + 3800 * t) * (rnd() * 2 - 1 - lp);
    out[i] = lp * Math.sin(Math.PI * t) ** 1.5 * 0.9;
  }
  return out;
}

function roar(): Float32Array {
  // 70 Hz sawtooth with growl vibrato + lowpassed noise, fast attack, long decay
  const n = seconds(0.9);
  const out = new Float32Array(n);
  const rnd = mulberry32(2);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (70 + 12 * Math.sin(2 * Math.PI * 6 * t)) / RATE;
    const saw = 2 * (phase - Math.floor(phase)) - 1;
    lp += lpAlpha(900) * (rnd() * 2 - 1 - lp);
    out[i] = (saw * 0.6 + lp * 0.5) * Math.min(1, t * 8) * (1 - t) ** 0.7;
  }
  return out;
}

function shing(): Float32Array {
  // Inharmonic metallic partials with fast exponential decay
  const n = seconds(0.5);
  const out = new Float32Array(n);
  const partials = [2500, 3700, 5200];
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let s = 0;
    for (const [k, f] of partials.entries()) s += Math.sin(2 * Math.PI * f * t) / (k + 1);
    out[i] = s * Math.exp(-t * 9) * 0.5;
  }
  return out;
}

function fire(): Float32Array {
  // Lowpassed noise with random crackle pops. lpAlpha depends on RATE, so the
  // 0.785 trim is tuned for 16 kHz: it peaks at about -1.6 dBFS, under the
  // ceiling and at the level chosen by ear.
  const n = seconds(1.2);
  const out = new Float32Array(n);
  const rnd = mulberry32(4);
  let lp = 0;
  let crackle = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if (rnd() < 0.002) crackle = 1;
    crackle *= 0.995;
    lp += lpAlpha(1200) * (rnd() * 2 - 1 - lp);
    out[i] = lp * (0.5 + crackle) * Math.min(1, t * 6) * Math.min(1, (1 - t) * 4) * 0.785;
  }
  return out;
}

function chime(): Float32Array {
  // C6-E6-G6 square-ish arpeggio, each note ringing out
  const notes = [1046.5, 1318.5, 1568.0];
  const noteLen = 0.22;
  const tail = 0.35;
  const n = seconds(notes.length * noteLen + tail);
  const out = new Float32Array(n);
  notes.forEach((f, k) => {
    const start = seconds(k * noteLen);
    const len = seconds(noteLen + tail);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      const tone = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.18 + Math.sin(2 * Math.PI * f * t) * 0.2;
      out[start + i] += tone * Math.exp(-t * 6);
    }
  });
  return out;
}

function bark(): Float32Array {
  // Two yaps ~220ms apart. Each is a noise transient (the bite) over a
  // falling square tone (the "wuf"), under a fast exponential decay.
  const n = seconds(0.45);
  const out = new Float32Array(n);
  const rnd = mulberry32(6);
  for (const start of [0, seconds(0.22)]) {
    const len = seconds(0.12);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      const env = Math.exp(-t * 38);
      const freq = 620 - 300 * (i / len);
      const tone = Math.sign(Math.sin(2 * Math.PI * freq * t));
      const noise = (rnd() * 2 - 1) * Math.exp(-t * 120);
      out[start + i] = (tone * 0.55 + noise * 0.45) * env * 0.8;
    }
  }
  return out;
}

function gallop(): Float32Array {
  // Four hoof triplets: each hoof a thumpy lowpassed noise burst with a
  // falling pitch body, the triplet's da-da-DUM rhythm repeated.
  const n = seconds(1.1);
  const out = new Float32Array(n);
  const rnd = mulberry32(7);
  const triplet = [0, 0.09, 0.18];
  for (let rep = 0; rep < 4; rep++) {
    triplet.forEach((off, k) => {
      const start = seconds(rep * 0.27 + off);
      const len = seconds(k === 2 ? 0.09 : 0.06);
      let lp = 0;
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / RATE;
        lp += lpAlpha(300) * (rnd() * 2 - 1 - lp);
        const thump = Math.sin(2 * Math.PI * (120 - 60 * (i / len)) * t);
        out[start + i] += (thump * 0.6 + lp * 0.6) * Math.exp(-t * 45) * (k === 2 ? 0.9 : 0.6);
      }
    });
  }
  return out;
}

function neigh(): Float32Array {
  // A whinny: bright sawtooth sliding down an octave under fast vibrato,
  // with a breathy noise layer that fades in toward the tail.
  const n = seconds(0.8);
  const out = new Float32Array(n);
  const rnd = mulberry32(8);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = (880 - 440 * t) * (1 + 0.06 * Math.sin(2 * Math.PI * 22 * (i / RATE)));
    phase += freq / RATE;
    const saw = 2 * (phase - Math.floor(phase)) - 1;
    lp += lpAlpha(2500) * (rnd() * 2 - 1 - lp);
    out[i] = (saw * 0.45 + lp * 0.35 * t) * Math.min(1, t * 10) * (1 - t) ** 0.8;
  }
  return out;
}

function sparkle(): Float32Array {
  // Glittery cascade: short high sine pings on a rising pentatonic ladder,
  // each with a fast decay, scattered by the seeded PRNG.
  const n = seconds(0.9);
  const out = new Float32Array(n);
  const rnd = mulberry32(9);
  const ladder = [1567.98, 1760.0, 2093.0, 2349.32, 2637.02, 3135.96];
  for (let k = 0; k < 12; k++) {
    const start = seconds(k * 0.06 + rnd() * 0.02);
    const f = ladder[Math.floor(rnd() * ladder.length)];
    const len = seconds(0.18);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      out[start + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 18) * 0.25;
    }
  }
  return out;
}

function squeak(): Float32Array {
  // Two quick rising chirps -- a small-critter "eek-eek": a sine gliding up
  // an octave under a fast decay, twice, ~220ms apart. Pure sweeps, no PRNG.
  const n = seconds(0.4);
  const out = new Float32Array(n);
  for (const start of [0, seconds(0.22)]) {
    const len = seconds(0.14);
    let phase = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / RATE;
      phase += (1300 + 1300 * (i / len)) / RATE;
      out[start + i] += Math.sin(2 * Math.PI * phase) * Math.exp(-t * 22) * 0.6;
    }
  }
  return out;
}

const SFX: Record<string, () => Float32Array> = {
  sfx_whoosh: whoosh,
  sfx_roar: roar,
  sfx_shing: shing,
  sfx_fire: fire,
  sfx_chime: chime,
  sfx_bark: bark,
  sfx_gallop: gallop,
  sfx_neigh: neigh,
  sfx_sparkle: sparkle,
  sfx_squeak: squeak,
};

/** The repertoire, exposed so a test can measure a synth without writing a
 *  bundle. The ids are exactly troupe.json's sfx_vocabulary. */
export { SFX };

/** Synthesize one sfx at the delivery rate. Throws on an unknown id. */
export function synthSfx(id: string): Float32Array {
  const gen = SFX[id];
  if (!gen) throw new Error(`${id}: no synth — add one to tools/gen-sfx.ts`);
  return gen();
}

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run gen:sfx -- --bundle <dir>",
    options: { bundle: { type: "string", required: true } },
  });
  const bundle = loadBundle(values.bundle);

  // The bundle's manifest decides which sounds it ships — mirroring how the
  // player's actor list comes from its cast rather than a hand-kept constant.
  const over: string[] = [];
  for (const asset of bundle.perf.assets.audio) {
    if (asset.kind !== "sfx") continue;
    const samples = synthSfx(asset.id);
    const file = assetPath(bundle.dir, asset.uri);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, encodeWav(samples, RATE));
    // encodeWav clamps to [-1, 1], so measure the samples rather than the file:
    // a synth that overshoots would otherwise read back as exactly 0 dBFS with
    // nothing saying how far past the ceiling it actually went.
    const peak = peakDb(samples);
    const verdict = peak > PEAK_CEILING_DB ? "OVER CEILING" : "ok";
    console.log(`wrote ${file} — peak ${peak.toFixed(2)} dBFS (ceiling ${PEAK_CEILING_DB}) ${verdict}`);
    if (peak > PEAK_CEILING_DB) over.push(`${asset.id} at ${peak.toFixed(2)} dBFS`);
  }
  if (over.length > 0) {
    throw new Error(
      `${over.length} sfx over the ${PEAK_CEILING_DB} dBFS peak ceiling: ${over.join(", ")}. ` +
        `sfx are never normalised toward the loudness target — quiet the synth instead.`,
    );
  }
}

runCli(import.meta.url, main);
