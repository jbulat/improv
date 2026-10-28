// The cold-boot contract between the firmware and the Lua app. main.cpp sends
// a `boot_restore` event after restoring a persisted app; the story must then
// hold its title until someone presses a button. A story that was just pushed
// gets no such event and must still auto-play, which is what makes
// /push-story self-verifying.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildApp } from "../tools/build-app";
import { emitTroupeStubLua } from "../tools/gen-troupe-header";

const stubDir = mkdtempSync(path.join(tmpdir(), "troupe-stub-boot-"));
const troupeStubPath = path.join(stubDir, "troupe-stub.lua");
writeFileSync(troupeStubPath, emitTroupeStubLua());

const { outPath } = buildApp("player", "fixtures/knight-and-lonely-dragon");

function run(mode: "hold" | "auto" | "stall", buttonIndex?: number): Record<string, string> {
  const args = ["tests/lua/run-boot-restore.lua", outPath, troupeStubPath, mode];
  if (buttonIndex !== undefined) args.push(String(buttonIndex));
  const out = execFileSync("lua", args, {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  const kv: Record<string, string> = {};
  for (const line of out.trim().split("\n")) {
    const i = line.indexOf(" ");
    kv[line.slice(0, i)] = line.slice(i + 1);
  }
  return kv;
}

describe("cold-boot restore holds the story until a press", () => {
  const r = run("hold");

  it("enters the ready state when the firmware announces a restore", () => {
    expect(r.AFTER_INIT).toBe("title");
    expect(r.AFTER_EVENT).toBe("ready");
  });

  it("silences the chime that init queued", () => {
    // init() already ran player_reset(), which calls sound_stop() once on
    // its own -- so "was anything ever stopped" would pass even if
    // player_hold() never called sound_stop() at all. The stop count must
    // move again, specifically across the boot_restore event, to prove
    // player_hold() did its own stop.
    expect(Number(r.STOPS_AFTER_EVENT)).toBeGreaterThan(Number(r.STOPS_AFTER_INIT));
  });

  it("does not advance past the title on its own", () => {
    // 4 s of ticks, twice the 2 s title: a held story must not start itself.
    expect(r.AFTER_WAIT).toBe("ready:1");
  });

  it("plays no narration before the press", () => {
    expect(r.LINES_BEFORE_PRESS).toBe("0");
  });

  it("renders the title screen, not the first beat", () => {
    // on_tick routes anything that is not title/done to draw_beat, so `ready`
    // must be in the title branch. Silence alone would not reveal this.
    expect(r.HINT_DRAWN).toBe("true");
  });

  it("starts the story from its title when pressed", () => {
    expect(r.AFTER_PRESS).toBe("title");
    expect(r.AFTER_PRESS_TICKS).toBe("playing:1");
    expect(Number(r.LINES_AFTER_PRESS)).toBeGreaterThan(0);
  });
});

describe("a freshly pushed story still auto-plays", () => {
  const r = run("auto");

  it("never enters the ready state", () => {
    expect(r.AFTER_INIT).toBe("title");
    expect(r.AFTER_EVENT).toBe("title");
  });

  it("reaches playing without any press", () => {
    expect(r.AFTER_WAIT.startsWith("playing:")).toBe(true);
    expect(Number(r.LINES_BEFORE_PRESS)).toBeGreaterThan(0);
  });

  it("does not stop audio on its own, with no boot_restore event sent", () => {
    // Nothing should touch the stop count between init and this check when
    // there is no event to react to -- confirms the hold-mode increase
    // above is caused by the event, not by something incidental.
    expect(r.STOPS_AFTER_EVENT).toBe(r.STOPS_AFTER_INIT);
  });
});

describe("a stalled loop does not teleport the story forward", () => {
  // The device's first loop() runs Courier before any tick, and Courier's
  // autoConnect() blocks for up to ~20 s waiting on WiFi. That whole stall
  // arrives as the first dt_ms, ahead of any queued event -- so the clamp,
  // not the boot_restore event, is what has to hold the line here. This mode
  // deliberately sends no boot_restore for that reason.
  const r = run("stall");

  it("stays on the title through a 20 s dt", () => {
    expect(r.AFTER_STALL).toBe("title:1");
  });

  it("charges the stall as one ordinary tick", () => {
    expect(Number(r.ELAPSED_AFTER_STALL)).toBeLessThanOrEqual(1000);
  });

  it("plays no narration", () => {
    expect(r.LINES_FROM_STALL).toBe("0");
  });
});

describe("the ready state starts on any button, not just index 1", () => {
  // player_button's dispatch below the ready special-case treats index 0
  // and index 1 differently (player_reset vs pause/resume), so pressing
  // index 0 here, unlike the index-1 press above, checks player.lua's claim
  // that "press to play" does not need the right button.
  const r = run("hold", 0);

  it("starts the held story when button 0 is pressed from ready", () => {
    expect(r.AFTER_EVENT).toBe("ready");
    expect(r.AFTER_PRESS).toBe("title");
    expect(r.AFTER_PRESS_TICKS).toBe("playing:1");
    expect(Number(r.LINES_AFTER_PRESS)).toBeGreaterThan(0);
  });
});
