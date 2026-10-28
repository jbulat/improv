import { describe, it, expect } from "vitest";
import { FrameResampler, FPS } from "../tools/lib/video-frames";

/** A 1-byte-per-frame stand-in: real frames are 135*240*3, but the resampler
 *  never looks inside one, so a tagged single byte makes the assertions read
 *  as the sequence of frames it actually is. */
function tagged(n: number): Uint8Array {
  return Uint8Array.from([n]);
}

function collect(endMs: number, pushes: [number, number][]): number[] {
  const out: number[] = [];
  const r = new FrameResampler({ write: (f) => out.push(f[0]) }, { fps: FPS, endMs });
  for (const [tag, atMs] of pushes) r.push(tagged(tag), atMs);
  r.finish();
  return out;
}

describe("FrameResampler", () => {
  it("lets the last flip in a slot win", () => {
    // init flips twice at t=0; the tick's draw must supersede the title card.
    expect(
      collect(300, [
        [1, 0],
        [2, 0],
        [3, 100],
        [4, 200],
      ]),
    ).toEqual([2, 3, 4]);
  });

  it("holds the last frame across slots that received no flip", () => {
    expect(
      collect(500, [
        [1, 0],
        [2, 300],
      ]),
    ).toEqual([1, 1, 1, 2, 2]);
  });

  it("emits exactly ceil(endMs * fps / 1000) frames", () => {
    expect(collect(59860, [[1, 0]]).length).toBe(599);
    expect(collect(1000, [[1, 0]]).length).toBe(10);
    expect(collect(1001, [[1, 0]]).length).toBe(11);
  });

  it("returns the frame count from finish() and is idempotent", () => {
    const out: number[] = [];
    const r = new FrameResampler({ write: (f) => out.push(f[0]) }, { fps: FPS, endMs: 300 });
    r.push(tagged(7), 0);
    expect(r.finish()).toBe(3);
    expect(r.finish()).toBe(3);
    expect(out).toEqual([7, 7, 7]);
  });

  it("ignores flips past endMs rather than overrunning the timeline", () => {
    expect(
      collect(200, [
        [1, 0],
        [2, 100],
        [3, 900],
      ]),
    ).toEqual([1, 2]);
  });

  it("writes nothing when no frame was ever pushed", () => {
    expect(collect(500, [])).toEqual([]);
  });
});
