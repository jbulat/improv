// The Improv local simulator. Runs the unmodified .device.lua bundle in
// the system `lua`, rasterizes its draw ops into a 135x240 portrait frame, and
// models WAV playback authoritatively. --headless is the same code path with
// no panel and a virtual clock, which is what the playback test drives.
//
//   npm run sim -- --bundle fixtures/knight-and-lonely-dragon
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildApp } from "./build-app";
import { emitTroupeStubLua } from "./gen-troupe-header";
import { bundleDirs } from "./lib/bundle";
import { PORT, ROOT, UsageError, parseCli, runCli } from "./lib/cli";
import { LuaHost, composeApp } from "./lib/sim-lua";
import { Raster, applyDrawOp, type Op } from "./lib/sim-raster";
import { SimAudio, type PlayEvent } from "./lib/sim-audio";
import { openSession, stageBundle } from "./lib/sim-session";
import { startPanelServer, type PanelServer } from "./lib/sim-server";

export const TICK_MS = 100;

export interface Telemetry {
  tickMs: number;
  dtMs: number;
  frames: number;
  volume: number;
  channels: ReturnType<SimAudio["state"]>;
  unpreloaded: number;
}

export interface SimTrace {
  frames: number;
  preloads: string[];
  plays: PlayEvent[];
  stops: number[];
  beeps: [number, number][];
  texts: string[];
  warnings: string[];
  unpreloaded: string[];
  error: string | null;
  exitCode: number | null;
}

export interface SimOptions {
  bundleDir?: string;
  sessionRoot?: string;
  deviceId?: string;
  headless?: boolean;
  clock?: "real" | "virtual";
  maxMs?: number;
  dumpFrames?: string;
  flashStallMs?: number;
  port?: number;
  /** Which app to run. "viewer" is the art-review browser for the resident
   *  troupe; it takes no bundle and stages no audio. */
  entry?: "player" | "viewer";
  /** Called on every flip. `atMs` is sim-clock ms since the run began. Frames
   *  follow flips, not a fixed cadence, so `seq` is not a timeline. */
  onFrame?: (rgb: Uint8Array, seq: number, atMs: number) => void;
  onTelemetry?: (t: Telemetry) => void;
  onLog?: (level: string, message: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Why runSim cannot run with `opts`, or null when it can. runSim throws it as
 * an error; the CLI reports it as a usage error.
 */
export function simOptionsProblem(opts: SimOptions): string | null {
  const entry = opts.entry ?? "player";
  // The viewer has no story, so a bundle is an error, not something to ignore.
  if (entry === "viewer" && opts.bundleDir) {
    return "--entry viewer takes no --bundle (it browses art, not stories)";
  }
  if (entry === "player" && !opts.bundleDir) return "needs a bundleDir";
  const headless = opts.headless ?? false;
  const clock = opts.clock ?? (headless ? "virtual" : "real");

  // NaN or a value <= 0 fails the loop's `now() < maxMs` check at once and
  // returns an empty trace that looks like a valid run, so only a finite,
  // positive maxMs is accepted.
  if (opts.maxMs !== undefined && (!Number.isFinite(opts.maxMs) || opts.maxMs <= 0)) {
    return `--max-ms must be a finite, positive number, got ${opts.maxMs}`;
  }
  // An unbounded virtual clock runs as fast as it can, forever: an app that
  // never exits would spin at full CPU. A story's length cannot be guessed,
  // so there is no default.
  if (clock === "virtual" && opts.maxMs === undefined) {
    return (
      '--max-ms is required when clock is "virtual" (the default under --headless); ' +
      "without it the tick loop never terminates. Pass --max-ms <ms> for the run length."
    );
  }
  // --port is an error when no panel server is started, not a silent no-op.
  if (headless && opts.port !== undefined) {
    return "--port has no effect under --headless (no panel server is started)";
  }
  return null;
}

export async function runSim(opts: SimOptions): Promise<SimTrace> {
  const problem = simOptionsProblem(opts);
  if (problem) throw new Error(`runSim: ${problem}`);
  const entry = opts.entry ?? "player";
  const bundleDir = opts.bundleDir;
  const headless = opts.headless ?? false;
  const clock = opts.clock ?? (headless ? "virtual" : "real");
  const flashStallMs = opts.flashStallMs ?? 0;

  const session = openSession(opts.sessionRoot ?? path.join(ROOT, ".sim"), opts.deviceId);
  const appPath = path.join(session.dir, "app.lua");
  // The viewer has no story to stage — it reads art, not audio.
  if (bundleDir) stageBundle(session, bundleDir);

  // Always rebuild: the build is cheap and pure, and a stale bundle is the
  // confusion the sim exists to remove. A bundle expects a resident `troupe`
  // global (the firmware's TroupeArtDriver), so the sim adds the stub the
  // headless Lua harnesses use, which always reports the current fingerprint.
  const { outPath } = buildApp(entry, bundleDir);
  writeFileSync(appPath, composeApp(readFileSync(outPath, "utf8"), emitTroupeStubLua()));

  // Virtual time advances a fixed TICK_MS per tick so the headless test covers
  // a 45 s performance in well under a second, deterministically.
  let virtualMs = 0;
  const startedAt = Date.now();
  // Real time spent frozen (the panel's freeze control) is left out of the
  // clock, so the playback model does not age a clip nobody is hearing.
  let frozenMs = 0;
  const now = () => (clock === "virtual" ? virtualMs : Date.now() - startedAt - frozenMs);

  const ras = new Raster();
  const audio = new SimAudio(session.dir, { now });

  const trace: SimTrace = {
    frames: 0,
    preloads: audio.preloads,
    plays: audio.events,
    stops: audio.stops,
    beeps: [],
    texts: [],
    warnings: audio.warnings,
    unpreloaded: [],
    error: null,
    exitCode: null,
  };

  if (opts.dumpFrames) mkdirSync(opts.dumpFrames, { recursive: true });

  let server: PanelServer | null = null;
  let pendingStallMs = 0;
  // LuaHost takes one tick() or button() at a time. Presses arrive on HTTP
  // callbacks, unsynchronized with the tick loop, so they are queued here and
  // sent from inside the loop; calling host.button() directly races
  // host.tick() and hangs the loop.
  const pendingButtons: number[] = [];
  // The freeze control's last-seen state, so each edge acts once: entering a
  // freeze stops the panel's audio (SimAudio keeps its channels), and leaving
  // it replays those channels at their model position.
  let wasFrozen = false;

  const emitFrame = () => {
    trace.frames++;
    const seq = trace.frames;
    if (opts.dumpFrames) {
      writeFileSync(path.join(opts.dumpFrames, `frame-${String(seq).padStart(6, "0")}.png`), ras.toPng());
    }
    opts.onFrame?.(ras.snapshot(), seq, now());
    server?.pushFrame(ras.snapshot(), seq);
  };

  const onOp = (op: Op) => {
    if (applyDrawOp(ras, op)) {
      if (op[0] === "qr") {
        // Through audio.warn() (trace.warnings is audio.warnings), which
        // deduplicates, so a QR drawn every frame warns once.
        audio.warn("screen.qr is a placeholder in the simulator (no QR encoder)");
      }
      if (op[0] === "text") trace.texts.push(String(op[3] ?? ""));
      return;
    }
    switch (op[0]) {
      case "flip":
        emitFrame();
        return;
      case "beep":
        trace.beeps.push([Number(op[1]), Number(op[2])]);
        server?.pushSound({ kind: "beep", freq: Number(op[1]), ms: Number(op[2]) });
        return;
      case "tone":
        server?.pushSound({ kind: "tone", freq: Number(op[1]) });
        return;
      case "tone_stop":
        server?.pushSound({ kind: "tone_stop" });
        return;
      case "audio.stop": {
        const ch = Number(op[1]);
        audio.stop(ch < 0 ? undefined : ch);
        server?.pushSound({ kind: "stop", channel: ch });
        return;
      }
      case "audio.set_volume":
        audio.setVolume(Number(op[1]));
        server?.pushSound({ kind: "volume", volume: audio.volume });
        return;
      case "log":
        opts.onLog?.(String(op[1]), String(op[2]));
        server?.pushLog(String(op[1]), String(op[2]));
        return;
      default:
        opts.onLog?.("warn", `unknown op: ${JSON.stringify(op)}`);
        return;
    }
  };

  const onQuery = (name: string, args: (string | number)[]): boolean | number => {
    switch (name) {
      case "audio.preload":
        return audio.preload(String(args[0]));
      case "audio.play": {
        const ok = audio.play(String(args[0]), Number(args[1]), Number(args[2]));
        if (ok && audio.lastPlayUnpreloaded) {
          trace.unpreloaded.push(String(args[0]));
          pendingStallMs += flashStallMs;
        }
        if (ok) {
          server?.pushSound({
            kind: "play",
            path: String(args[0]),
            channel: Number(args[1]),
            offsetMs: Number(args[2]),
          });
        }
        return ok;
      }
      case "audio.is_playing":
        return audio.isPlaying(Number(args[0]));
      case "button.press_count":
        return server?.pressCount ?? 0;
      default:
        opts.onLog?.("warn", `unknown query: ${name}`);
        return 0;
    }
  };

  // Once LuaHost.start resolves there is a live child, so any later throw
  // (onTelemetry, startPanelServer, a loop bug) must still quit it and close
  // the panel server. LuaHost already catches onOp throws (safeOnOp).
  const host = await LuaHost.start(appPath, { onOp, onQuery });
  try {
    if (!headless) {
      server = await startPanelServer({
        port: opts.port,
        sessionDir: session.dir,
        deviceId: session.deviceId,
        bundleName: bundleDir ? path.basename(bundleDir) : "(no story)",
        onButton: (index) => pendingButtons.push(index),
      });
      console.log(`sim: ${server.url}  device ${session.deviceId}`);
    }

    const maxMs = opts.maxMs ?? Number.POSITIVE_INFINITY;
    let lastTickAt = Date.now();

    // `exited`, not `crashed`: a child that exits cleanly is just as gone, and
    // tick() on it resolves at once with no output.
    while (!host.exited && now() < maxMs) {
      // Send every queued press, one at a time, before the next tick.
      while (pendingButtons.length > 0 && !host.exited) {
        await host.button(pendingButtons.shift()!);
      }
      if (host.exited) break;
      // dtMs is the true per-tick delta that the panel's Clock shows: TICK_MS
      // on the virtual clock, the wall delta on the real clock, 0 while
      // frozen. A fixed TICK_MS on the real clock would hide drift and stalls.
      let dtMs: number;
      if (clock === "virtual") {
        virtualMs += TICK_MS;
        await host.tick(TICK_MS);
        dtMs = TICK_MS;
        // --flash-stall-ms: on the device the stall uses time the beat clock
        // sees, so the virtual clock advances by it instead of sleeping.
        if (pendingStallMs > 0) {
          virtualMs += pendingStallMs;
          pendingStallMs = 0;
        }
      } else if (server?.frozen) {
        // A sim-level freeze, not the device's pause (chassis Button 1,
        // handled in the Lua app). No tick, clock advance or audio, but
        // telemetry continues so the panel shows frozen, not hung.
        if (!wasFrozen) {
          wasFrozen = true;
          server.pushSound({ kind: "stop", channel: -1 });
        }
        const before = Date.now();
        await sleep(TICK_MS);
        frozenMs += Date.now() - before;
        lastTickAt = Date.now();
        dtMs = 0;
      } else {
        if (wasFrozen) {
          // Leaving a freeze: only the panel's audio stopped, so replay each
          // live channel at its model position.
          wasFrozen = false;
          for (const ch of audio.state()) {
            server?.pushSound({ kind: "play", path: ch.path, channel: ch.channel, offsetMs: ch.elapsedMs });
          }
        }
        const wallDt = Date.now() - lastTickAt;
        lastTickAt = Date.now();
        dtMs = Math.max(1, wallDt);
        await host.tick(dtMs);
        if (pendingStallMs > 0) {
          await sleep(pendingStallMs);
          pendingStallMs = 0;
        }
        const spent = Date.now() - lastTickAt;
        if (spent < TICK_MS) await sleep(TICK_MS - spent);
      }
      opts.onTelemetry?.({
        tickMs: TICK_MS,
        dtMs,
        frames: trace.frames,
        volume: audio.volume,
        channels: audio.state(),
        unpreloaded: trace.unpreloaded.length,
      });
      server?.pushTelemetry({
        tickMs: TICK_MS,
        dtMs,
        frames: trace.frames,
        volume: audio.volume,
        channels: audio.state(),
        unpreloaded: trace.unpreloaded.length,
      });
    }

    trace.error = host.crashed;
  } finally {
    const { code } = await host.quit();
    trace.exitCode = code;
    await server?.close();
  }
  return trace;
}

const USAGE = [
  "usage: npm run sim -- --bundle <dir> [options]",
  "       npm run sim -- --entry viewer     (browse the troupe's art)",
  "options: --headless --max-ms <ms> --clock real|virtual --port <n> --device-id <id>",
  "         --dump-frames <dir> --flash-stall-ms <ms>",
].join("\n");

export async function main(argv: string[]): Promise<number | void> {
  const { values } = parseCli(argv, {
    usage: USAGE,
    options: {
      bundle: { type: "string" },
      entry: { type: "string", choices: ["player", "viewer"] },
      "device-id": { type: "string" },
      port: PORT,
      headless: { type: "boolean" },
      clock: { type: "string", choices: ["real", "virtual"] },
      "max-ms": { type: "number" },
      "dump-frames": { type: "string" },
      "flash-stall-ms": { type: "number" },
    },
  });
  const opts: SimOptions = {
    bundleDir: values.bundle,
    entry: values.entry,
    deviceId: values["device-id"],
    port: values.port,
    headless: values.headless,
    clock: values.clock,
    maxMs: values["max-ms"],
    dumpFrames: values["dump-frames"],
    flashStallMs: values["flash-stall-ms"],
    onLog: (level, message) => console.log(`[${level}] ${message}`),
  };
  // A missing story lists the bundles there are to choose from.
  if (opts.entry !== "viewer" && !opts.bundleDir) {
    const bundles = bundleDirs().map((d) => `  ${d}`);
    const message = ["no story given: pass --bundle <dir>", "bundles:", ...bundles];
    throw new UsageError(message.join("\n"), USAGE);
  }
  const problem = simOptionsProblem(opts);
  if (problem) throw new UsageError(problem, USAGE);

  const trace = await runSim(opts);
  if (trace.error) {
    console.error(trace.error);
    return 1;
  }
  console.log(`frames ${trace.frames}, plays ${trace.plays.length}, warnings ${trace.warnings.length}`);
}

runCli(import.meta.url, main);
