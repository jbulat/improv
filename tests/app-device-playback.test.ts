import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildApp } from "../tools/build-app";
import { emitTroupeStubLua, loadAllActors } from "../tools/gen-troupe-header";
import { troupeArtFingerprint } from "../tools/gen-sprite-data";

// mkdtemp so concurrent runs on one machine can't clobber each other's stubs.
const stubDir = mkdtempSync(path.join(tmpdir(), "troupe-stub-"));

describe("device bundle playback (headless, stubbed audio driver)", () => {
  const { outPath } = buildApp("player", "fixtures/knight-and-lonely-dragon");
  const stubPath = path.join(stubDir, "troupe-stub.lua");
  writeFileSync(stubPath, emitTroupeStubLua());
  const out = execFileSync("lua", ["tests/lua/run-device-playback.lua", outPath, stubPath], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });

  it("queues the clip manifest at init instead of loading it", () => {
    // Loading the whole clip set at app load costs about 1.7 s on hardware
    // (22 clips for fixtures/meet-the-troupe), so init() only queues it and
    // the title's ticks drain it. The single warm clip is the title chime,
    // which player_reset fires from inside init().
    const m = /WARM_AT_INIT (\d+) (\d+)/.exec(out)!;
    expect(Number(m[1])).toBe(1);
    expect(Number(m[2])).toBe(19);
  });

  it("drains the whole manifest, in order, before the title ends", () => {
    const m = /WARM_AFTER_TITLE (\d+) (\d+)/.exec(out)!;
    expect(m[1]).toBe(m[2]);
    expect(Number(m[1])).toBe(19);
    expect(out).toContain("DRAIN_FIRST stories/knight-and-lonely-dragon/aud_000.wav");
  });

  it("never plays a clip cold, including the chime fired from inside init", () => {
    // A clip that reaches audio.play before the drain gets to it loads
    // synchronously and stalls that dispatch. The chime is the awkward one:
    // player_reset fires it during init(), before any tick has run, so
    // sfx_trigger warms it before playing.
    expect(/UNPRELOADED_COUNT (\d+)/.exec(out)![1]).toBe("0");
    expect(out).toContain("UNPRELOADED_FIRST nil");
  });

  it("opens with the title chime on the sfx channel, then beat 1's line on 0", () => {
    expect(out).toContain("FIRST_PLAY stories/knight-and-lonely-dragon/sfx_chime.wav 1");
    expect(out).toContain("LINE1 stories/knight-and-lonely-dragon/aud_000.wav");
  });

  it("pause stops all channels; the story runs to done", () => {
    expect(out).toContain("PAUSE_STOP_ALL true");
    expect(out).toContain("STATE done");
  });

  it("resumes the current beat's line in sync, at the elapsed offset frozen by pause", () => {
    const elapsed = Number(/ELAPSED_AT_PAUSE (\d+)/.exec(out)![1]);
    // ticks(25) into a 2000 ms title: 25*100 - 2000 = 500 ms into beat 1.
    expect(elapsed).toBe(500);
    expect(out).toContain(`RESUME_PLAY stories/knight-and-lonely-dragon/aud_000.wav 0 ${elapsed}`);
  });

  it("plays exactly the baked lines and sfx cues", () => {
    const lines = /LINES (\d+) (\d+)/.exec(out)!;
    expect(lines[1]).toBe(lines[2]);
    const sfx = /SFX (\d+) (\d+)/.exec(out)!;
    expect(sfx[1]).toBe(sfx[2]);
  });
});

describe("device bundle fails loudly on an art mismatch", () => {
  const { outPath } = buildApp("player", "fixtures/a-dog-called-bear");
  const run = (stub?: string) =>
    execFileSync("lua", ["tests/lua/run-art-error.lua", outPath, ...(stub ? [stub] : [])], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });

  it("renders the mismatch message and survives ticks and buttons", () => {
    const stub = path.join(stubDir, "troupe-stub-wrong.lua");
    writeFileSync(stub, emitTroupeStubLua("00000000"));
    const out = run(stub);
    const lines = panelLines(out);
    expect(lines.join(" ")).toContain("Art set mismatch.");
    expect(lines.join(" ")).toContain("00000000.");
    expectFitsScreen(lines);
    expect(out).toContain("SURVIVED true");
  });

  it("renders the firmware-too-old message when troupe is absent", () => {
    const out = run();
    const lines = panelLines(out);
    expect(lines.join(" ")).toContain("This story needs newer");
    expectFitsScreen(lines);
    expect(out).toContain("SURVIVED true");
  });
});

/** The panel's rendered lines, in draw order, from the harness's TEXTS line. */
function panelLines(out: string): string[] {
  const m = /^TEXTS (.*)$/m.exec(out);
  if (!m) throw new Error("harness printed no TEXTS line");
  return m[1].length ? m[1].split("|") : [];
}

/** The panel draws at size 2, which fits 11 characters across the 135 px
 *  screen; size 1 is too small to read on hardware. A longer line runs off
 *  the right edge, and the panel exists to be read. */
function expectFitsScreen(lines: string[]): void {
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(11);
}

describe("device bundle fails loudly when troupe.install itself errors", () => {
  // Fingerprint matches, so the prelude reaches the install call -- but the
  // driver blows up mid-install (unknown actor, malformed chunk, OOM parse).
  // Without a pcall around that call, this error would propagate out of the
  // app's top-level chunk: init/on_tick/on_event never get defined, and the
  // device silently falls back to its idle "Ready" screen instead of showing
  // S.art_error. This proves the install is protected.
  const { outPath } = buildApp("player", "fixtures/a-dog-called-bear");
  const { actors, palette } = loadAllActors();
  const fp = troupeArtFingerprint(actors, palette);

  it("sets S.art_error naming the install failure and survives ticks and buttons", () => {
    const stub = path.join(stubDir, "troupe-stub-install-throws.lua");
    writeFileSync(
      stub,
      [
        "troupe = {}",
        `function troupe.fingerprint() return "${fp}" end`,
        // level 0: no "<chunkname>:<line>:" prefix. This stub lives under
        // tmpdir(), so the default level 1 would prepend a ~60-char temp path
        // that exists only in this harness -- it would dominate the panel and
        // test the tmpdir layout rather than the message. The real driver's
        // luaL_error prefix is a short chunk name like [string "ada"]:12:.
        'function troupe.install(S, ids) error("boom: unknown actor", 0) end',
      ].join("\n") + "\n",
    );
    const out = execFileSync("lua", ["tests/lua/run-art-error.lua", outPath, stub], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    const lines = panelLines(out);
    expect(lines.join(" ")).toContain("Resident art install");
    expect(lines.join(" ")).toContain("boom: unknown actor");
    expectFitsScreen(lines);
    expect(out).toContain("SURVIVED true");
  });
});
