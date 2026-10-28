// Turns the simulator's flips into a fixed-rate video timeline. Flips arrive
// at 0, 0, 100, 200, ... ms (init flips twice, and the virtual clock advances
// before each tick), so frames are binned by timestamp: arrival order would
// put the video 200 ms behind its audio. The sink is injected, so this module
// does no I/O and its timeline logic is a plain unit under test.

/** Where resampled frames go. Production passes a raw-file writer. */
export interface FrameSink {
  write(rgb: Uint8Array): void;
}

/** Device tick rate, and so the natural video frame rate. */
export const FPS = 10;

export class FrameResampler {
  private sink: FrameSink;
  private fps: number;
  private totalSlots: number;
  private nextSlot = 0;
  private held: Uint8Array | null = null;

  constructor(sink: FrameSink, opts: { fps: number; endMs: number }) {
    if (!Number.isFinite(opts.fps) || opts.fps <= 0) {
      throw new Error(`FrameResampler: fps must be finite and positive, got ${opts.fps}`);
    }
    if (!Number.isFinite(opts.endMs) || opts.endMs < 0) {
      throw new Error(`FrameResampler: endMs must be finite and non-negative, got ${opts.endMs}`);
    }
    this.sink = sink;
    this.fps = opts.fps;
    this.totalSlots = Math.ceil((opts.endMs * opts.fps) / 1000);
  }

  /** Emit held frames up to (not including) `slot`. */
  private fillTo(slot: number): void {
    const limit = Math.min(slot, this.totalSlots);
    while (this.nextSlot < limit) {
      // Only reachable with a held frame: fillTo is called from push (which
      // holds one first) and from finish (which returns early without one).
      this.sink.write(this.held!);
      this.nextSlot++;
    }
  }

  push(rgb: Uint8Array, atMs: number): void {
    const slot = Math.floor((atMs * this.fps) / 1000);
    // A flip past the end has nowhere to go. It is not an error -- the run is
    // stopped by wall-clock maxMs, which need not land on a slot boundary --
    // so it is dropped rather than allowed to extend the timeline.
    if (slot >= this.totalSlots) return;
    // Everything before this flip's own slot is settled, so flush it. The
    // flip itself is only held: a later flip in the same slot supersedes it,
    // which is exactly how the tick's draw replaces init's title card.
    if (this.held !== null) this.fillTo(slot);
    this.held = rgb;
  }

  /** Pad the held frame out to the end of the timeline. Returns the total
   *  frames written, and may be called more than once. */
  finish(): number {
    if (this.held !== null) this.fillTo(this.totalSlots);
    return this.nextSlot;
  }
}
