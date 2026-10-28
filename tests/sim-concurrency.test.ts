// A panel button press arrives on its own HTTP callback, unsynchronized with
// the real-clock tick loop's `await host.tick(dtMs)`. LuaHost's waitIdle
// (tools/lib/sim-lua.ts) is a single pending-idle slot: a second call
// overwrites it and orphans the first call's promise, so the child stays alive
// but the tick loop hangs forever, with no crash and no error. tools/sim.ts
// queues presses and drains them inside the loop; if a press reached
// host.button() straight from the callback, this test would time out.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { runSim } from "../tools/sim";

const BUNDLE = "fixtures/knight-and-lonely-dragon";

describe("button presses concurrent with the tick loop", () => {
  it("does not deadlock the sim when a press lands mid-tick", async () => {
    // runSim() does not return the panel's URL: it prints it with
    // console.log once the server is listening, just before the tick loop
    // starts. Capturing it here exercises the same wiring a browser tab uses.
    const originalLog = console.log;
    let url = "";
    console.log = ((...args: unknown[]) => {
      const line = args.map(String).join(" ");
      const m = /^sim: (\S+)\s/.exec(line);
      if (m) url = m[1];
      originalLog(...args);
    }) as typeof console.log;

    const maxMs = 2500;
    const trace = runSim({
      bundleDir: BUNDLE,
      sessionRoot: mkdtempSync(path.join(tmpdir(), "sim-concurrency-")),
      headless: false,
      clock: "real",
      maxMs,
    });

    // Fire presses back to back for the whole run, never awaiting one before
    // the next. The race window is only the few ms of a host.tick() round
    // trip in each ~100 ms cycle, and a button()-vs-button() overlap is
    // harmless (nothing awaits those promises), so only a continuous flood
    // makes a press land in an in-flight tick() at least once.
    let flooding = true;
    const flood = (async () => {
      const deadline = Date.now() + 5000;
      while (!url) {
        if (Date.now() > deadline) return; // panel never started; let the trace await surface it
        await new Promise((r) => setTimeout(r, 5));
      }
      while (flooding) {
        fetch(`${url}/input`, { method: "POST", body: JSON.stringify({ button: 0 }) }).catch(() => {});
        await new Promise((r) => setTimeout(r, 3));
      }
    })();

    try {
      // The real assertion is that this resolves at all. A button() call
      // landing while host.tick() is in flight would orphan the tick's
      // promise, and this would hang until the test timeout below.
      const result = await trace;
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
    } finally {
      flooding = false;
      await flood;
      console.log = originalLog;
    }
  }, 20_000);
});
