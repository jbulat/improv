// Exports a story bundle as a shareable .mp4 -- the device screen with its
// narration and sfx -- so a story can be sent to someone without filming the
// simulator panel with a phone.
//
//   npm run export:video -- --bundle fixtures/knight-and-lonely-dragon
//
// Runs the same runSim the panel does, headless on the virtual clock, so a
// 60-second story exports in well under 15 seconds.
import { spawnSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBundle } from "./lib/bundle";
import { parseCli, runCli } from "./lib/cli";
import { FRAME_H, FRAME_W, SCREEN_X, SCREEN_Y, renderDeviceBody } from "./lib/device-frame";
import { encodePng } from "./lib/png";
import { SCREEN_H, SCREEN_W } from "./lib/sim-raster";
import { mixTrace } from "./lib/video-audio";
import { FPS, FrameResampler, type FrameSink } from "./lib/video-frames";
import { runSim } from "./sim";
import type { Performance } from "./lib/types";

/** The player holds its title card this long before beat 1. Mirrors TITLE_MS
 *  in device-apps/improv/src/player.lua; if the two differ, the exported
 *  title card is clipped or padded by the difference. */
export const TITLE_MS = 2000;

/** How long to hold the "The End" screen. The player never exits -- on_tick
 *  redraws that screen forever -- so the export decides where to stop. */
export const TAIL_MS = 2000;

/** A fixed device id, so the session directory (and therefore the root the
 *  play list's relative paths resolve against) is knowable without runSim
 *  handing it back. openSession puts the session at <root>/<deviceId>. */
const DEVICE_ID = "sim-export";

const SCALED_W = SCREEN_W * 4;
const SCALED_H = SCREEN_H * 4;

export function runLengthMs(perf: Performance): number {
  if (!perf.timeline?.length) throw new Error("export-video: performance has no beats");
  const beats = perf.timeline.reduce((n, b) => n + b.duration_ms, 0);
  return TITLE_MS + beats + TAIL_MS;
}

/** The duration of one video frame, in ms -- the grid both output streams
 *  must land on. */
const FRAME_MS = 1000 / FPS;

/** The run length, rounded up to a whole number of frames. video-frames.ts
 *  ceils endMs to a frame count and video-audio.ts rounds it to a sample
 *  count; on an unaligned endMs the two disagree by up to a frame, and
 *  ffmpeg's `-shortest` then truncates the longer stream. */
export function quantizedEndMs(perf: Performance): number {
  return Math.ceil(runLengthMs(perf) / FRAME_MS) * FRAME_MS;
}

/** ffmpeg's path, or a thrown error naming the install. Checked before the
 *  sim runs so a machine without it fails in a second rather than after
 *  rendering several hundred frames. */
export function findFfmpeg(): string {
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.error) {
    throw new Error(
      "export-video needs ffmpeg, which is not on PATH.\n" + "  Install it with:  brew install ffmpeg",
    );
  }
  return "ffmpeg";
}

/** A FrameSink writing raw rgb24 to an open file descriptor. */
function fileSink(fd: number): FrameSink {
  return { write: (rgb) => void writeSync(fd, rgb) };
}

export async function exportVideo(opts: {
  bundleDir: string;
  outPath: string;
  /** Composite the screen into a mock device body. On by default: most
   *  viewers have never held a StickS3, and bare 135x240 pixel art on a phone
   *  reads as a low-quality video. Pass false for the bare screen. */
  frame?: boolean;
}): Promise<{ outPath: string; frames: number; clipped: number; warnings: string[] }> {
  const ffmpeg = findFfmpeg();
  const bundle = loadBundle(opts.bundleDir);
  const endMs = quantizedEndMs(bundle.perf);

  const work = mkdtempSync(path.join(tmpdir(), "export-video-"));
  const rawPath = path.join(work, "frames.raw");
  const wavPath = path.join(work, "mix.wav");
  const bodyPath = path.join(work, "body.png");
  const sessionRoot = path.join(work, "session");

  try {
    const fd = openSync(rawPath, "w");
    let open = true;
    try {
      const resampler = new FrameResampler(fileSink(fd), { fps: FPS, endMs });
      const trace = await runSim({
        bundleDir: opts.bundleDir,
        sessionRoot,
        deviceId: DEVICE_ID,
        headless: true,
        clock: "virtual",
        maxMs: endMs,
        onFrame: (rgb, _seq, atMs) => resampler.push(rgb, atMs),
      });
      if (trace.error) throw new Error(`export-video: the app failed: ${trace.error}`);
      const frames = resampler.finish();
      closeSync(fd);
      open = false;

      const mix = mixTrace(trace.plays, { audioRoot: path.join(sessionRoot, DEVICE_ID), endMs });
      writeFileSync(wavPath, mix.wav);

      // Resolved once, so the two readers cannot treat `undefined` differently.
      const framed = opts.frame ?? true;
      // Drawn per export rather than committed: this repo tracks no binary
      // images, and a generated body stays reviewable as code.
      if (framed) writeFileSync(bodyPath, encodePng(FRAME_W, FRAME_H, renderDeviceBody()));

      mkdirSync(path.dirname(opts.outPath), { recursive: true });
      await runFfmpeg(ffmpeg, rawPath, wavPath, opts.outPath, framed ? bodyPath : null);

      return { outPath: opts.outPath, frames, clipped: mix.clipped, warnings: trace.warnings };
    } finally {
      // Only for paths that threw before the success path closed fd.
      if (open) closeSync(fd);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function runFfmpeg(
  bin: string,
  rawPath: string,
  wavPath: string,
  outPath: string,
  bodyPath: string | null,
): Promise<void> {
  // scale with flags=neighbor, not the default bicubic: the art is hand-placed
  // pixel sprites and any interpolation smears it. x4 also keeps both axes
  // even, which H.264's 4:2:0 chroma subsampling requires.
  const scale = `scale=${SCALED_W}:${SCALED_H}:flags=neighbor`;
  // Framed: the scaled screen is overlaid on the body at its exact origin and
  // never resized, so the 4x pixel grid survives. -loop 1 keeps the
  // single-image input from ending the graph after one frame.
  const frameArgs = bodyPath
    ? [
        // -framerate must match FPS: the body is the base layer, so it sets
        // the output timebase, and an image input defaults to 25 fps.
        "-framerate",
        String(FPS),
        "-loop",
        "1",
        "-i",
        bodyPath,
        // shortest=1 on the overlay: the looped body is infinite, so the
        // screen stream running out must end the graph.
        "-filter_complex",
        `[0:v]${scale}[s];[2:v][s]overlay=${SCREEN_X}:${SCREEN_Y}:shortest=1[v]`,
        "-map",
        "[v]",
        "-map",
        "1:a",
      ]
    : ["-vf", scale];
  const args = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${SCREEN_W}x${SCREEN_H}`,
    "-r",
    String(FPS),
    "-i",
    rawPath,
    "-i",
    wavPath,
    ...frameArgs,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-shortest",
    outPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      // A truncated .mp4 sitting on disk is worse than no file: it looks like
      // a successful export until someone tries to play it.
      rmSync(outPath, { force: true });
      reject(new Error(`ffmpeg exited ${code}\n${stderr.trim()}`));
    });
  });
}

/** The CLI's options, read off argv. The output defaults to
 *  .video-export/<bundle>.mp4. */
function readArgs(argv: string[]): { bundleDir: string; outPath: string; frame: boolean } {
  const { values } = parseCli(argv, {
    usage: "usage: npm run export:video -- --bundle <dir> [--out <file.mp4>] [--no-frame]",
    options: {
      bundle: { type: "string", required: true },
      out: { type: "string" },
      "no-frame": { type: "boolean" },
    },
    removed: {
      frame:
        "--frame was removed: the device body is the default now. " +
        "Drop the flag, or pass --no-frame for the bare screen.",
    },
  });
  return {
    bundleDir: values.bundle,
    outPath: values.out ?? path.join(".video-export", `${path.basename(values.bundle)}.mp4`),
    frame: !values["no-frame"],
  };
}

/**
 * Whether the CLI composites the device body, read off argv. Framed is the
 * default and `--no-frame` turns it off. `--frame` is rejected, not ignored,
 * so a caller learns that the flag does nothing.
 */
export function frameFromArgs(args: string[]): boolean {
  return readArgs(args).frame;
}

export async function main(argv: string[]): Promise<void> {
  const r = await exportVideo(readArgs(argv));
  // A missing clip is a silent gap in the audio, so report it here.
  for (const w of r.warnings) console.warn(`[warn] ${w}`);
  if (r.clipped > 0) console.warn(`[warn] ${r.clipped} samples clipped in the mix`);
  console.log(`${r.outPath} (${r.frames} frames @ ${FPS} fps)`);
}

runCli(import.meta.url, main);
