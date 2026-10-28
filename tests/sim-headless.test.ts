import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { runSim, type SimTrace } from "../tools/sim";

const BUNDLE = "fixtures/knight-and-lonely-dragon";
const ROOT = "stories/knight-and-lonely-dragon";

describe("headless playback of the real device bundle", () => {
  // Run once in beforeAll, not at describe level: a describe-level runSim()
  // runs during collection even when every test here is filtered out
  // (`vitest -t`), and its rejection becomes an unhandled-rejection warning
  // instead of a test failure.
  //
  // The run takes about 2-4 s. The 30 s timeout absorbs a loaded machine but
  // stays well under the ~45 s a real-time clock would take, so a run that
  // falls back from the virtual clock to real time fails instead of passing
  // slowly.
  let trace: SimTrace;

  beforeAll(async () => {
    // 60 s of virtual time covers the ~40 s fixture with room to reach "done".
    trace = await runSim({
      bundleDir: BUNDLE,
      sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
      headless: true,
      maxMs: 60_000,
    });
  }, 30_000);

  it("warms the full clip manifest, draining across the title", () => {
    // Counted distinctly: init() queues the set rather than loading it, and
    // sfx_trigger warms the title chime on use, so the chime is preloaded
    // twice and a raw call count would not say whether coverage is complete.
    expect(new Set(trace.preloads).size).toBe(19);
    expect(trace.preloads[0]).toBe(`${ROOT}/sfx_chime.wav`); // warmed on use
    expect(trace.preloads[1]).toBe(`${ROOT}/aud_000.wav`); // first off the queue
  });

  it("opens with the title chime on the sfx channel, then beat 1's line on 0", () => {
    expect(trace.plays[0]).toMatchObject({ path: `${ROOT}/sfx_chime.wav`, channel: 1 });
    const firstLine = trace.plays.find((p) => p.channel === 0)!;
    expect(firstLine.path).toBe(`${ROOT}/aud_000.wav`);
  });

  it("never plays a clip it did not preload", () => {
    expect(trace.unpreloaded).toEqual([]);
  });

  it("flips one frame per tick and reaches the end of the story", () => {
    expect(trace.frames).toBeGreaterThan(500);
    expect(trace.texts).toContain("The End");
  });

  it("produces no warnings and no Lua error", () => {
    expect(trace.warnings).toEqual([]);
    expect(trace.error).toBeNull();
    expect(trace.exitCode).toBe(0);
  });

  it("dumps a PNG per frame when asked", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "sim-frames-"));
    await runSim({
      bundleDir: BUNDLE,
      sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
      headless: true,
      maxMs: 500,
      dumpFrames: out,
    });
    const files = readdirSync(out).sort();
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files[0]).toMatch(/^frame-\d{6}\.png$/);
  });

  it("timestamps each frame with the virtual clock, not its arrival order", async () => {
    const stamps: number[] = [];
    await runSim({
      bundleDir: BUNDLE,
      sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
      headless: true,
      maxMs: 500,
      onFrame: (_rgb, _seq, atMs) => stamps.push(atMs),
    });
    // init flips twice before the tick loop starts (the loading card and the
    // title), and the virtual clock advances before host.tick(), so the first
    // tick's frame is at 100 -- not at 200, where its index would put it.
    expect(stamps.slice(0, 4)).toEqual([0, 0, 100, 200]);
  });
});

// The bundle above casts four actors. Actor art is resident in firmware, so
// the sim installs it through the generated `troupe` stub (tools/sim.ts)
// rather than reading it out of the bundle. A full-cast story exercises that
// path hardest, installing all seven chunks at once, and meet-the-troupe is
// that story by construction: no story can cast more than the whole troupe.
describe("headless playback of a full-cast bundle (all seven resident actors)", () => {
  const FULL_CAST = "fixtures/meet-the-troupe";
  // Every cast member's display_name, drawn top-left on that member's beats.
  const NAMES = ["Miss Moon", "Bruno", "Milo", "Ada", "Rosa", "Pip", "Tuk"];
  let trace: SimTrace;

  beforeAll(async () => {
    // 90 s, not the 60 s above: this story's lines total 61.2 s (knight's
    // total 33.5 s) and the title card plus inter-beat gaps sit on top of
    // that, so 60 s stops mid-story and never reaches "The End". Virtual
    // time still advances a fixed 100 ms per tick, so the extra 30 s costs
    // ~300 ticks of wall time, not 30 s of it.
    trace = await runSim({
      bundleDir: FULL_CAST,
      sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
      headless: true,
      maxMs: 90_000,
    });
  }, 30_000);

  // Each name only reaches the screen if that beat drew its character, which
  // only happens if S.sprites[actor] exists -- so seven names is seven
  // actors' art successfully installed from the resident set, not just an
  // install that returned without raising.
  it("installs and renders every one of the seven resident actors", () => {
    for (const name of NAMES) expect(trace.texts).toContain(name);
  });

  it("plays through to the end of the story", () => {
    expect(trace.texts).toContain("The End");
  });

  // Not the guard against a missing or mismatched art set: that path sets
  // S.art_error and the app goes inert cleanly (no warning, no error, exit 0),
  // as main.lua's guard intends, and the two tests above catch it. This one
  // catches an install that raises or warns instead of being handled.
  it("produces no warnings and no Lua error", () => {
    expect(trace.warnings).toEqual([]);
    expect(trace.error).toBeNull();
    expect(trace.exitCode).toBe(0);
  });
});

describe("real-clock telemetry", () => {
  // On the real clock, the rail's dt readout is the wall-clock delta between
  // ticks, which varies with scheduling jitter even over a short run. A
  // constant 100 ms would hide the drift and stalls the readout exists to
  // show. (The virtual clock advances a fixed TICK_MS per tick, so it is not
  // exercised here.) --headless with clock: "real" starts no panel but still
  // drives the real-clock tick loop, so this sees the same dtMs the rail
  // would render.
  it("reports the true wall-clock delta per tick, not a constant", async () => {
    const samples: number[] = [];
    await runSim({
      bundleDir: BUNDLE,
      sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
      headless: true,
      clock: "real",
      maxMs: 1000,
      onTelemetry: (t) => samples.push(t.dtMs),
    });
    expect(samples.length).toBeGreaterThan(1);
    expect(new Set(samples).size).toBeGreaterThanOrEqual(2);
  });
});

describe("bad input", () => {
  it("refuses a bundle directory that does not exist", async () => {
    await expect(
      runSim({
        bundleDir: "fixtures/no-such-story",
        sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
        headless: true,
        maxMs: 200,
      }),
    ).rejects.toThrow();
  });

  // NaN would make the tick loop's `now() < maxMs` check false on the very
  // first pass -- a silent zero-iteration "success" instead of the caller
  // error a mistyped --max-ms actually is.
  it("refuses a non-finite maxMs instead of silently running zero ticks", async () => {
    await expect(
      runSim({
        bundleDir: BUNDLE,
        sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
        headless: true,
        maxMs: NaN,
      }),
    ).rejects.toThrow();
  });

  // A non-positive maxMs passes a bare Number.isFinite check and would
  // produce the same silent zero-tick trace (frames=2, plays=1, exit=0,
  // error=null for maxMs: -1).
  it("refuses a non-positive maxMs instead of silently running zero ticks", async () => {
    await expect(
      runSim({
        bundleDir: BUNDLE,
        sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
        headless: true,
        maxMs: -1,
      }),
    ).rejects.toThrow();
  });

  // An unbounded virtual clock ("run as fast as possible, forever") is
  // refused up front instead of spinning the tick loop forever. The
  // rejection names the problem so a caller, or the CLI's error output, can
  // act on it.
  it("refuses an unbounded virtual clock instead of hanging", async () => {
    await expect(
      runSim({
        bundleDir: BUNDLE,
        sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
        headless: true,
        // maxMs deliberately omitted: headless implies clock: "virtual".
      }),
    ).rejects.toThrow(/--max-ms/);
  });

  // A throwing onTelemetry must still quit the lua child before the
  // rejection propagates: the rejection carries the original error, and no
  // lua child process is left running afterwards.
  it("closes the lua child even when onTelemetry throws mid-run", async () => {
    const before = activeChildProcessHandleCount();
    await expect(
      runSim({
        bundleDir: BUNDLE,
        sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-headless-")),
        headless: true,
        maxMs: 5_000,
        onTelemetry: () => {
          throw new Error("boom from onTelemetry");
        },
      }),
    ).rejects.toThrow("boom from onTelemetry");
    // runSim's finally awaits host.quit() before rejecting, so the child's
    // "close" event has fired, but Node lists the closing process handle
    // until a later turn of the event loop. Wait for the count to drop,
    // bounded well inside the leak this guards against (a child alive for
    // 5 s and more).
    const deadline = Date.now() + 2_000;
    while (activeChildProcessHandleCount() > before && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(activeChildProcessHandleCount()).toBeLessThanOrEqual(before);
  });
});

/** Count of live child-process handles keeping the Node event loop alive.
 *  runSim and LuaHost expose no child pid, so this reads Node's internal
 *  handle list to show that a spawned `lua` child does not outlive a
 *  throwing consumer. */
function activeChildProcessHandleCount(): number {
  const getHandles = (
    process as unknown as { _getActiveHandles?: () => { constructor?: { name?: string } }[] }
  )._getActiveHandles;
  if (!getHandles) return 0;
  return getHandles.call(process).filter((h) => h?.constructor?.name === "ChildProcess").length;
}
