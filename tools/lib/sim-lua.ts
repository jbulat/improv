// Spawns and drives the `lua` child that runs the built bundle. Node is the
// clock: it sends one event at a time and waits for the child's ["idle"] before
// sending the next, which is what guarantees a query reply can never be
// mistaken for an event.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { Op } from "./sim-raster";

export const SIM_HOST_PATH = fileURLToPath(new URL("./sim-host.lua", import.meta.url));

export interface LuaHandlers {
  onOp(op: Op): void;
  onQuery(name: string, args: (string | number)[]): boolean | number;
}

/**
 * The prelude, then `hostSource` (stand-ins for the firmware's native drivers,
 * which the device's sandbox does not restrict), then the sandbox, then the
 * built bundle, then the trailer that starts the read loop.
 */
export function composeApp(bundleSource: string, hostSource = ""): string {
  const prelude = readFileSync(SIM_HOST_PATH, "utf8");
  return `${prelude}\n${hostSource}\n__sim_sandbox()\n${bundleSource}\n__sim_main()\n`;
}

export class LuaHost {
  private child: ChildProcessWithoutNullStreams;
  private handlers: LuaHandlers;
  private waitIdle: (() => void) | null = null;
  private stderr = "";
  private exitedPromise: Promise<{ code: number | null; stderr: string }>;
  private resolveExited!: (result: { code: number | null; stderr: string }) => void;
  private _crashed: string | null = null;

  /** Set once Lua reports a runtime error, a compile error is inferred from
   * a non-zero exit, or the child fails to spawn. The first reason wins. */
  get crashed(): string | null {
    return this._crashed;
  }

  /** True once the child is no longer running for any reason: crashed,
   * exited cleanly (e.g. its stdin closed), or never started. A clean exit is
   * not a crash, but tick() and button() on a gone child resolve at once
   * with no output, so a tick loop must check this. */
  get exited(): boolean {
    return this.child.exitCode !== null || this._crashed !== null;
  }

  private constructor(child: ChildProcessWithoutNullStreams, handlers: LuaHandlers) {
    this.child = child;
    this.handlers = handlers;
    this.exitedPromise = new Promise((resolve) => {
      this.resolveExited = resolve;
    });

    // Registered once for the child's lifetime, not per tick.
    child.on("close", (code, signal) => {
      // A non-zero exit with no ["error", ...] line (e.g. a Lua compile
      // error, which happens before sim-host.lua's guard() runs) is a crash.
      if (code !== 0 && this._crashed === null) {
        // `code` is null when a signal killed the process, so name the signal.
        const fallback =
          code === null ? `lua was killed by signal ${signal ?? "unknown"}` : `lua exited with code ${code}`;
        this.recordCrash(this.stderr.trim() || fallback);
      }
      this.resolveExited({ code, stderr: this.stderr });
      // A crash, a compile error, or the child dying underneath a pending
      // tick()/button() must not leave that call's promise pending forever.
      this.resolveIdle();
    });

    // If `lua` is not on PATH, spawn() emits "error" instead of starting the
    // child. Unhandled, that would end the Node process with a bare
    // "spawn lua ENOENT"; here it becomes a readable crash reason.
    child.on("error", (err: NodeJS.ErrnoException) => {
      const detail =
        err.code === "ENOENT" ? `the "${child.spawnfile}" interpreter was not found on PATH` : err.message;
      this.recordCrash(`failed to start lua: ${detail}`);
      this.resolveIdle();
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      this.stderr += d;
    });
    // A crashed or already-exited child can close its stdin pipe before we
    // notice via exitCode; without this, that write races into an unhandled
    // EPIPE instead of the no-op the closed-child checks elsewhere intend.
    child.stdin.on("error", () => {});
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
  }

  static async start(appPath: string, handlers: LuaHandlers, luaBin = "lua"): Promise<LuaHost> {
    const child = spawn(luaBin, [appPath], { stdio: ["pipe", "pipe", "pipe"] });
    const host = new LuaHost(child, handlers);
    await host.untilIdle();
    return host;
  }

  private onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    if (!Array.isArray(parsed)) {
      // Anything that is not a JSON array (print("hi"), print("42"),
      // print('{"a":1}')) is the app's own output, not an op.
      this.safeOnOp(["log", "info", line]);
      return;
    }
    const op = parsed as Op;
    if (op[0] === "?") {
      const name = String(op[1]);
      const args = op.slice(2);
      let value: boolean | number;
      let logMessage: string | null = null;
      try {
        value = this.handlers.onQuery(name, args);
      } catch (err) {
        // Lua is blocked waiting for a reply, so a throw still gets one (a
        // safe fallback). The failure is reported after the reply is
        // written, because reporting goes through onOp, which can throw too.
        value = false;
        logMessage = `onQuery("${name}") threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      // Only a boolean or a finite number is written as the reply. Any other
      // value could break the one-line protocol (a string "1\nb 9" would
      // inject a button press), so it gets the same fallback as a throw.
      let encoded: string;
      if (typeof value === "boolean") {
        encoded = value ? "t" : "f";
      } else if (typeof value === "number" && Number.isFinite(value)) {
        encoded = String(value);
      } else {
        encoded = "f";
        if (logMessage === null) {
          logMessage = `onQuery("${name}") returned an invalid reply (not a boolean or finite number): ${JSON.stringify(value)}`;
        }
      }
      this.child.stdin.write(`r ${encoded}\n`);
      if (logMessage !== null) {
        this.safeOnOp(["log", "error", logMessage]);
      }
      return;
    }
    if (op[0] === "idle") {
      this.resolveIdle();
      return;
    }
    if (op[0] === "error") {
      this.recordCrash(String(op[1] ?? ""));
      this.resolveIdle();
      return;
    }
    this.safeOnOp(op);
  }

  /** Calls the caller-supplied onOp. A throw would escape the readline
   * handler as an uncaught exception and end the process, so it is caught
   * and reported. */
  private safeOnOp(op: Op): void {
    try {
      this.handlers.onOp(op);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[sim-lua] onOp threw for ${JSON.stringify(op)}: ${message}\n`);
    }
  }

  /** First crash reason wins; a fallback discovered later (e.g. a bare exit
   * code once the process closes) must not overwrite a more specific one. */
  private recordCrash(message: string): void {
    if (this._crashed === null) this._crashed = message;
  }

  /** Resolves the tick()/button()/start() call waiting for the next ["idle"],
   * if any. The only place that settles `waitIdle`; every exit path (idle,
   * Lua error, process close, spawn error) calls it, so no caller hangs. */
  private resolveIdle(): void {
    const resolve = this.waitIdle;
    this.waitIdle = null;
    resolve?.();
  }

  /** Resolves at the next ["idle"], or immediately if the child already
   * exited or crashed. */
  private untilIdle(): Promise<void> {
    if (this.child.exitCode !== null || this._crashed !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waitIdle = resolve;
    });
  }

  private async send(line: string): Promise<void> {
    if (this.child.exitCode !== null || this._crashed !== null) return;
    // Diagnostic only: an overlapping call orphans the earlier promise (see
    // tick()), so report the misuse rather than hang silently.
    if (this.waitIdle !== null) {
      process.stderr.write(
        "[sim-lua] LuaHost.tick()/button() called while a previous call is still pending -- " +
          "these must be awaited one at a time (see tick()/button() doc comments); " +
          "the earlier call's promise will now never resolve.\n",
      );
    }
    const idle = this.untilIdle();
    this.child.stdin.write(`${line}\n`);
    await idle;
  }

  /** Sends one tick and waits for the matching ["idle"]. Calls must be
   * awaited one at a time -- overlapping tick()/button() calls share the
   * single pending-idle slot, so only the most recently issued one settles. */
  tick(dtMs: number): Promise<void> {
    return this.send(`t ${Math.round(dtMs)}`);
  }

  /** Same one-at-a-time requirement as tick() -- see its doc comment. */
  button(index: number): Promise<void> {
    return this.send(`b ${index}`);
  }

  async quit(): Promise<{ code: number | null; stderr: string }> {
    if (this.child.exitCode === null && this._crashed === null) {
      this.child.stdin.write("q\n");
      this.child.stdin.end();
    }
    return this.exitedPromise;
  }
}
