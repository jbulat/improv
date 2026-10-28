// The simulator's authoritative playback model. The browser panel makes the
// noise, but it is never asked anything: what is playing is computed here from
// a start time and the clip's real duration, so is_playing stays honest with
// the tab closed and headless runs work at all.
//
// Mirrors DEVICE-SKILL.md: channel 0 narration, channel 1 sfx pre-mixed at
// 40%, one shared master volume, and a missing or malformed clip that returns
// false with a warning rather than throwing.
import { readFileSync } from "node:fs";
import path from "node:path";
import { decodeWav } from "./wav";

export const NARRATION_CHANNEL = 0;
export const SFX_CHANNEL = 1;
export const SFX_CHANNEL_GAIN = 0.4;

export interface PlayEvent {
  path: string;
  channel: number;
  offsetMs: number;
  atMs: number;
  unpreloaded: boolean;
}

interface Playing {
  path: string;
  startedAt: number;
  offsetMs: number;
  durationMs: number;
}

export class SimAudio {
  private root: string;
  private now: () => number;
  private cache = new Map<string, number>(); // rel path -> duration ms
  private warnedOnce = new Set<string>(); // messages already pushed to warnings
  private channels = new Map<number, Playing>();
  private vol = 255;

  readonly preloads: string[] = [];
  readonly events: PlayEvent[] = [];
  readonly stops: number[] = [];
  readonly warnings: string[] = [];
  lastPlayUnpreloaded = false;

  constructor(root: string, opts: { now: () => number }) {
    this.root = path.resolve(root);
    this.now = opts.now;
  }

  get volume(): number {
    return this.vol;
  }

  /** Push a warning the first time a message is seen. A bad path stays bad
   *  across repeated preload()/play() calls. Public because sim.ts sends its
   *  screen.qr warning here too (trace.warnings is this.warnings). */
  warn(message: string): void {
    if (this.warnedOnce.has(message)) return;
    this.warnedOnce.add(message);
    this.warnings.push(message);
  }

  /** Absolute path for a device-relative clip path, or null if it escapes. */
  private resolve(rel: string): string | null {
    const abs = path.resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) return null;
    return abs;
  }

  /** Duration in ms, reading and validating the file on first use.
   *  Failures are not cached; warn() keeps repeated misses out of the log. */
  private durationOf(rel: string): number | null {
    const hit = this.cache.get(rel);
    if (hit !== undefined) return hit;
    const abs = this.resolve(rel);
    if (!abs) {
      this.warn(`audio: refusing path outside the session root: ${rel}`);
      return null;
    }
    let ms: number;
    try {
      const wav = decodeWav(readFileSync(abs));
      if (wav.channels !== 1) {
        this.warn(`audio: ${rel} is ${wav.channels}-channel; the device takes mono only`);
        return null;
      }
      ms = Math.round((wav.samples.length / wav.sampleRate) * 1000);
    } catch (err) {
      this.warn(`audio: cannot read ${rel}: ${(err as Error).message}`);
      return null;
    }
    this.cache.set(rel, ms);
    return ms;
  }

  preload(rel: string): boolean {
    const ms = this.durationOf(rel);
    if (ms === null) return false;
    this.preloads.push(rel);
    return true;
  }

  play(rel: string, channel: number, offsetMs = 0): boolean {
    const unpreloaded = !this.cache.has(rel);
    const durationMs = this.durationOf(rel);
    // lastPlayUnpreloaded describes the last successful play, and its reader
    // checks this method's return value first, so failures leave it as is.
    if (durationMs === null) {
      return false;
    }
    // The driver is the authority on whether there is audio left to rejoin --
    // audio.lua's line_resume depends on this refusal.
    if (offsetMs >= durationMs) {
      return false;
    }
    const atMs = this.now();
    this.channels.set(channel, { path: rel, startedAt: atMs, offsetMs, durationMs });
    this.lastPlayUnpreloaded = unpreloaded;
    this.events.push({ path: rel, channel, offsetMs, atMs, unpreloaded });
    return true;
  }

  stop(channel?: number): void {
    if (channel === undefined || channel < 0) {
      this.channels.clear();
      this.stops.push(-1);
      return;
    }
    this.channels.delete(channel);
    this.stops.push(channel);
  }

  isPlaying(channel: number): boolean {
    const p = this.channels.get(channel);
    if (!p) return false;
    return this.now() - p.startedAt + p.offsetMs < p.durationMs;
  }

  /** What each channel is playing right now, for the panel's mixer readout.
   *  Reads the clock once, so the liveness check and elapsedMs agree. */
  state(): { channel: number; path: string; elapsedMs: number; durationMs: number }[] {
    const now = this.now();
    const out = [];
    for (const [channel, p] of this.channels) {
      const elapsedMs = now - p.startedAt + p.offsetMs;
      if (elapsedMs >= p.durationMs) continue;
      out.push({ channel, path: p.path, elapsedMs, durationMs: p.durationMs });
    }
    return out.sort((a, b) => a.channel - b.channel);
  }

  setVolume(v: number): void {
    this.vol = Math.max(0, Math.min(255, Math.round(v)));
  }
}
