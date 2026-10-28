import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runLengthMs,
  quantizedEndMs,
  TITLE_MS,
  TAIL_MS,
  exportVideo,
  frameFromArgs,
} from "../tools/export-video";
import { loadBundle } from "../tools/lib/bundle";
import { FRAME_H, FRAME_W } from "../tools/lib/device-frame";

describe("runLengthMs", () => {
  it("is the title card, every beat, and the tail", () => {
    const { perf } = loadBundle("fixtures/lulu-and-the-fringe-that-grew-back");
    const beats = perf.timeline.reduce((n, b) => n + b.duration_ms, 0);
    // The sum of the fixture's measured beat lengths: it moves whenever a
    // line is re-rendered.
    expect(beats).toBe(53648);
    expect(runLengthMs(perf)).toBe(TITLE_MS + 53648 + TAIL_MS);
    expect(runLengthMs(perf)).toBe(57648);
  });

  it("refuses a performance with no beats", () => {
    expect(() => runLengthMs({ timeline: [] } as never)).toThrow(/no beats/i);
  });
});

describe("TITLE_MS", () => {
  it("matches the player's title-card hold, so they can't silently drift apart", () => {
    // TITLE_MS is duplicated on purpose from device-apps/improv/src/player.lua
    // (parsing Lua would be worse). The runLengthMs test above cannot see the
    // Lua side move on its own; reading the source can.
    const src = readFileSync("device-apps/improv/src/player.lua", "utf8");
    const m = /^local TITLE_MS = (\d+)$/m.exec(src);
    if (!m)
      throw new Error(
        "TITLE_MS: couldn't find 'local TITLE_MS = <n>' in player.lua -- did the line get reformatted?",
      );
    expect(Number(m[1])).toBe(TITLE_MS);
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error === undefined;
const hasFfprobe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).error === undefined;

// Skipped rather than failed without ffmpeg/ffprobe: `npm test` must pass on
// a machine that has never installed either. The two
// ship separately on some distros/images, so both are checked -- probing only
// ffmpeg and then calling ffprobe in the test body fails on an empty stdout
// with a message pointing at codecs, not the missing binary.
describe.skipIf(!hasFfmpeg || !hasFfprobe)("exportVideo", () => {
  it("writes a playable mp4 with both a video and an audio stream", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "export-video-")), "story.mp4");
    const bundle = "fixtures/lulu-and-the-fringe-that-grew-back";
    const r = await exportVideo({ bundleDir: bundle, outPath: out });

    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(10_000);
    expect(r.frames).toBe(577);

    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1",
        out,
      ],
      { encoding: "utf8" },
    );
    expect(probe.stdout).toContain("codec_type=video");
    expect(probe.stdout).toContain("codec_type=audio");

    const { perf } = loadBundle(bundle);
    // Compare against the quantized target duration, not runLengthMs's raw
    // value: after the frame-grid quantization in export-video.ts, that is
    // what the tool asks ffmpeg for. The raw value would pass only by a hair
    // and make the tolerance below dishonestly tight.
    const expected = quantizedEndMs(perf) / 1000;
    const duration = Number(/duration=([\d.]+)/.exec(probe.stdout)?.[1]);
    expect(Math.abs(duration - expected)).toBeLessThan(0.05);

    // The frame count delivered in the file, not just what the tool reports.
    // If video-frames.ts and video-audio.ts round the end time differently,
    // -shortest silently drops the video's last frame and only this
    // assertion fails.
    const countProbe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "default=noprint_wrappers=1",
        out,
      ],
      { encoding: "utf8" },
    );
    const deliveredFrames = Number(/nb_read_frames=(\d+)/.exec(countProbe.stdout)?.[1]);
    expect(deliveredFrames).toBe(577);
    expect(deliveredFrames).toBe(r.frames);

    // Both streams share a time origin, the property the binning and mixing
    // design exists to protect (see the header comment in video-frames.ts).
    // Duration and frame count alone do not reveal an A/V offset at the mux
    // step.
    const startProbe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,start_time",
        "-of",
        "default=noprint_wrappers=1",
        out,
      ],
      { encoding: "utf8" },
    );
    const starts = startProbe.stdout.match(/start_time=([\d.]+)/g) ?? [];
    expect(starts.length).toBe(2);
    for (const s of starts) expect(s).toBe("start_time=0.000000");
  }, 60_000);

  it("composites into the device body by default, without disturbing the timeline", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "export-video-")), "framed.mp4");
    const bundle = "fixtures/knight-and-lonely-dragon";
    // No `frame` option anywhere in this call: the point of the test is that
    // the DEFAULT is framed.
    const r = await exportVideo({ bundleDir: bundle, outPath: out });

    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=width,height,nb_read_frames",
        "-of",
        "default=noprint_wrappers=1",
        out,
      ],
      { encoding: "utf8" },
    );
    expect(probe.stdout).toContain(`width=${FRAME_W}`);
    expect(probe.stdout).toContain(`height=${FRAME_H}`);

    // The framing must not cost or add a single frame. Two ffmpeg details make
    // this easy to get wrong and neither fails loudly: the looped body is the
    // overlay's BASE layer, so an image input left at its default 25 fps
    // drives the output timebase (2.5x the frames, 2.5x the duration), and a
    // bare -shortest does not reliably bound a filter_complex graph whose base
    // is infinite. Either way the file plays and looks correct.
    const delivered = Number(/nb_read_frames=(\d+)/.exec(probe.stdout)?.[1]);
    expect(delivered).toBe(r.frames);

    const { perf } = loadBundle(bundle);
    const durProbe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1", out],
      { encoding: "utf8" },
    );
    const duration = Number(/duration=([\d.]+)/.exec(durProbe.stdout)?.[1]);
    expect(Math.abs(duration - quantizedEndMs(perf) / 1000)).toBeLessThan(0.05);
  }, 90_000);

  it("exports the bare screen when the body is turned off", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "export-video-")), "bare.mp4");
    const r = await exportVideo({
      bundleDir: "fixtures/knight-and-lonely-dragon",
      outPath: out,
      frame: false,
    });

    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=width,height,nb_read_frames",
        "-of",
        "default=noprint_wrappers=1",
        out,
      ],
      { encoding: "utf8" },
    );
    // Hardcoded rather than read from SCALED_W/SCALED_H: the x4
    // nearest-neighbour upscale is a deliberate design choice, and an
    // assertion written against the constants would stay green through a
    // typo in them. Both dimensions, not the ratio -- a framed file is also
    // 9:16, so only the actual size separates bare from framed.
    expect(probe.stdout).toContain("width=540");
    expect(probe.stdout).toContain("height=960");
    expect(Number(/nb_read_frames=(\d+)/.exec(probe.stdout)?.[1])).toBe(r.frames);
  }, 90_000);
});

// The CLI's only decision, split out so it can be tested without paying for a
// full export. Framed is the default; `--no-frame` turns the body off.
describe("frameFromArgs", () => {
  it("frames by default and bares only on --no-frame", () => {
    expect(frameFromArgs(["--bundle", "fixtures/knight-and-lonely-dragon"])).toBe(true);
    expect(frameFromArgs(["--bundle", "x", "--no-frame"])).toBe(false);
  });

  // Rejected rather than ignored: an old script or doc may still pass
  // `--frame`, and accepting it silently would leave its author believing it
  // controls something it does not. The output would look right and the
  // intent would be wrong.
  it("rejects the removed --frame instead of quietly accepting it", () => {
    expect(() => frameFromArgs(["--bundle", "x", "--frame"])).toThrow(/--frame was removed/);
    expect(() => frameFromArgs(["--bundle", "x", "--frame"])).toThrow(/--no-frame/);
  });
});
