import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { SimAudio, SFX_CHANNEL_GAIN } from "../tools/lib/sim-audio";
import { encodeWav } from "../tools/lib/wav";

/** A session root holding stories/s/<name>.wav clips of the given lengths. */
function root(clips: Record<string, number>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sim-audio-"));
  const story = path.join(dir, "stories", "s");
  mkdirSync(story, { recursive: true });
  for (const [name, ms] of Object.entries(clips)) {
    const samples = new Float32Array(Math.round((ms / 1000) * 8000));
    writeFileSync(path.join(story, `${name}.wav`), encodeWav(samples, 8000));
  }
  return dir;
}

function clock() {
  const t = { ms: 0 };
  return { t, now: () => t.ms };
}

/** A valid, decodable 16-bit PCM WAV with 2 channels -- decodeWav averages
 *  channels rather than throwing, so the mono check has to be explicit. */
function encodeStereoWav(frames: number, sampleRate: number): Buffer {
  const data = Buffer.alloc(frames * 2 * 2); // 2 channels x 16-bit
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28); // byte rate
  header.writeUInt16LE(4, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe("SimAudio", () => {
  it("pre-mixes the sfx channel at 40%", () => {
    expect(SFX_CHANNEL_GAIN).toBe(0.4);
  });

  it("preloads a real clip and refuses a missing one without throwing", () => {
    const { now } = clock();
    const a = new SimAudio(root({ line: 1000 }), { now });
    expect(a.preload("stories/s/line.wav")).toBe(true);
    expect(a.preload("stories/s/nope.wav")).toBe(false);
    expect(a.warnings.join(" ")).toContain("nope.wav");
    expect(a.preloads).toEqual(["stories/s/line.wav"]);
  });

  it("reports a channel as playing until the clip's duration elapses", () => {
    const { t, now } = clock();
    const a = new SimAudio(root({ line: 1000 }), { now });
    a.preload("stories/s/line.wav");
    expect(a.isPlaying(0)).toBe(false);
    expect(a.play("stories/s/line.wav", 0)).toBe(true);
    expect(a.isPlaying(0)).toBe(true);
    t.ms = 999;
    expect(a.isPlaying(0)).toBe(true);
    t.ms = 1000;
    expect(a.isPlaying(0)).toBe(false);
  });

  it("keeps the two channels independent", () => {
    const { t, now } = clock();
    const a = new SimAudio(root({ line: 1000, chime: 200 }), { now });
    a.play("stories/s/line.wav", 0);
    a.play("stories/s/chime.wav", 1);
    t.ms = 500;
    expect(a.isPlaying(0)).toBe(true);
    expect(a.isPlaying(1)).toBe(false);
  });

  it("resumes at an offset, and refuses one past the clip's end", () => {
    // audio.lua's line_resume leans on the driver being the authority here.
    const { t, now } = clock();
    const a = new SimAudio(root({ line: 1000 }), { now });
    expect(a.play("stories/s/line.wav", 0, 600)).toBe(true);
    t.ms = 399;
    expect(a.isPlaying(0)).toBe(true);
    t.ms = 400;
    expect(a.isPlaying(0)).toBe(false);
    expect(a.play("stories/s/line.wav", 0, 1000)).toBe(false);
    expect(a.play("stories/s/line.wav", 0, 5000)).toBe(false);
  });

  it("stops one channel, or every channel with no argument", () => {
    const { now } = clock();
    const a = new SimAudio(root({ line: 1000, chime: 200 }), { now });
    a.play("stories/s/line.wav", 0);
    a.play("stories/s/chime.wav", 1);
    a.stop(0);
    expect(a.isPlaying(0)).toBe(false);
    expect(a.isPlaying(1)).toBe(true);
    a.stop();
    expect(a.isPlaying(1)).toBe(false);
    expect(a.stops).toEqual([0, -1]);
  });

  it("flags a play that skipped preload, since that stalls on real flash", () => {
    const { now } = clock();
    const a = new SimAudio(root({ line: 1000, chime: 200 }), { now });
    a.preload("stories/s/line.wav");
    a.play("stories/s/line.wav", 0);
    expect(a.lastPlayUnpreloaded).toBe(false);
    a.play("stories/s/chime.wav", 1);
    expect(a.lastPlayUnpreloaded).toBe(true);
    expect(a.events.at(-1)!.unpreloaded).toBe(true);
  });

  it("records each play with its channel, offset and time", () => {
    const { t, now } = clock();
    const a = new SimAudio(root({ line: 1000 }), { now });
    t.ms = 250;
    a.play("stories/s/line.wav", 0, 100);
    expect(a.events).toEqual([
      { path: "stories/s/line.wav", channel: 0, offsetMs: 100, atMs: 250, unpreloaded: true },
    ]);
  });

  it("reports live channel state for the panel's mixer readout", () => {
    const { t, now } = clock();
    const a = new SimAudio(root({ line: 1000, chime: 200 }), { now });
    expect(a.state()).toEqual([]);
    a.play("stories/s/line.wav", 0);
    a.play("stories/s/chime.wav", 1);
    t.ms = 100;
    expect(a.state()).toEqual([
      { channel: 0, path: "stories/s/line.wav", elapsedMs: 100, durationMs: 1000 },
      { channel: 1, path: "stories/s/chime.wav", elapsedMs: 100, durationMs: 200 },
    ]);
    t.ms = 300; // chime has ended; only the narration is still live
    expect(a.state().map((s) => s.channel)).toEqual([0]);
  });

  it("counts an offset as elapsed time in the readout", () => {
    const { t, now } = clock();
    const a = new SimAudio(root({ line: 1000 }), { now });
    a.play("stories/s/line.wav", 0, 400);
    t.ms = 50;
    expect(a.state()[0].elapsedMs).toBe(450);
  });

  it("clamps volume to 0-255", () => {
    const { now } = clock();
    const a = new SimAudio(root({}), { now });
    expect(a.volume).toBe(255);
    a.setVolume(200);
    expect(a.volume).toBe(200);
    a.setVolume(-5);
    expect(a.volume).toBe(0);
    a.setVolume(9999);
    expect(a.volume).toBe(255);
  });

  it("refuses a path that escapes the session root", () => {
    const { now } = clock();
    const a = new SimAudio(root({ line: 1000 }), { now });
    expect(a.play("../../etc/passwd", 0)).toBe(false);
    expect(a.preload("/etc/passwd")).toBe(false);
    expect(a.warnings.length).toBe(2);
  });

  it("refuses a file that is not a decodable mono PCM WAV", () => {
    const dir = root({ line: 1000 });
    writeFileSync(path.join(dir, "stories", "s", "junk.wav"), Buffer.from("not a wav at all"));
    const { now } = clock();
    const a = new SimAudio(dir, { now });
    expect(a.preload("stories/s/junk.wav")).toBe(false);
    expect(a.warnings.join(" ")).toContain("junk.wav");
  });

  it("refuses a stereo clip -- decodeWav averages channels rather than throwing", () => {
    const dir = root({ line: 1000 });
    writeFileSync(path.join(dir, "stories", "s", "stereo.wav"), encodeStereoWav(8000, 8000));
    const { now } = clock();
    const a = new SimAudio(dir, { now });
    expect(a.preload("stories/s/stereo.wav")).toBe(false);
    expect(a.warnings.join(" ")).toContain("stereo.wav");
  });

  it("agrees with isPlaying at the exact boundary, even with a clock that ticks between reads", () => {
    // If state() read this.now() twice (once inside isPlaying(), once for
    // elapsedMs), a clock that advances between the reads could report a
    // channel live with elapsedMs === durationMs, a state isPlaying() calls
    // ended. A frozen clock cannot show that.
    let reads = 0;
    // play() reads once, then a second read returns 999 and a third 1000. The
    // 999 matters: it keeps isPlaying() true, so a second read for elapsedMs
    // would see 1000 and produce the inconsistent state.
    const tickingNow = () => {
      reads += 1;
      return reads === 1 ? 0 : reads === 2 ? 999 : 1000;
    };
    const a = new SimAudio(root({ line: 1000 }), { now: tickingNow });
    a.play("stories/s/line.wav", 0); // reads===1 -> atMs = 0
    // state() reads now() once and reuses it, so both checks see 999 and
    // agree the channel is still live with elapsedMs = 999.
    expect(a.state()).toEqual([{ channel: 0, path: "stories/s/line.wav", elapsedMs: 999, durationMs: 1000 }]);
  });

  it("leaves lastPlayUnpreloaded untouched when a later, unrelated play() fails", () => {
    const { now } = clock();
    const a = new SimAudio(root({ line: 1000, chime: 200 }), { now });
    // An unpreloaded play succeeds -- the field correctly becomes true.
    expect(a.play("stories/s/chime.wav", 1)).toBe(true);
    expect(a.lastPlayUnpreloaded).toBe(true);
    // A later, unrelated play fails (missing file) -- must not clobber the
    // still-relevant signal from the successful play above.
    expect(a.play("stories/s/missing.wav", 0)).toBe(false);
    expect(a.lastPlayUnpreloaded).toBe(true);
    // Same for a failure via the offset-past-end path.
    expect(a.play("stories/s/line.wav", 0, 5000)).toBe(false);
    expect(a.lastPlayUnpreloaded).toBe(true);
  });

  it("warns once per distinct problem even when the bad path is hit repeatedly", () => {
    const { now } = clock();
    const a = new SimAudio(root({ line: 1000 }), { now });
    expect(a.preload("stories/s/missing.wav")).toBe(false);
    expect(a.play("stories/s/missing.wav", 0)).toBe(false);
    expect(a.play("stories/s/missing.wav", 1)).toBe(false);
    expect(a.warnings.length).toBe(1);
    expect(a.warnings[0]).toContain("missing.wav");
  });
});
