import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Guards for a silent failure on hardware: the device connects, the relay
// reports a live socket and returns HTTP 200 for every send, and no message is
// ever delivered. Nothing logs it.
// The checks below are cheap and static because the real thing they protect
// -- a device receiving relay messages -- needs hardware to observe.

const MAIN_CPP = readFileSync(new URL("../device/src/main.cpp", import.meta.url).pathname, "utf8");
const PLATFORMIO = readFileSync(new URL("../device/platformio.ini", import.meta.url).pathname, "utf8");

describe("courier receive configuration", () => {
  // Courier's Client::dispatchJSON early-returns when defaultTransport is null:
  //   if (!def || !def[0] || strcmp(transportName, def) != 0) return;
  // Transport *registration* treats null as "ws" instead, so the WebSocket still
  // registers and connects and looks perfectly healthy. That asymmetry is the
  // whole trap: a null here silently discards every inbound message.
  it("sets defaultTransport explicitly", () => {
    const m = MAIN_CPP.match(/courier\.defaultTransport\s*=\s*"([^"]*)"/);
    expect(
      m,
      "device/src/main.cpp must set courier.defaultTransport; when it is null " +
        "Courier drops every inbound message before any callback, with no log",
    ).not.toBeNull();
    expect(m![1]).not.toBe("");
  });

  // It must also match the name Courier auto-registers the WebSocket under.
  // dispatchJSON compares transportName against defaultTransport with strcmp,
  // so "websocket" or "WS" would drop everything exactly as null does.
  it('sets defaultTransport to "ws", the name the WS transport registers under', () => {
    const m = MAIN_CPP.match(/courier\.defaultTransport\s*=\s*"([^"]*)"/);
    expect(m![1]).toBe("ws");
  });
});

describe("firmware dependency pinning", () => {
  // A dependency fetched from a floating HEAD can pull in a change like the
  // dispatch rule above: it compiles clean and fails silently at runtime. Any
  // git dep can do this, so check them all.
  it("pins every URL dependency to an immutable ref", () => {
    // Line-based: lib_deps is an indented INI continuation block, ending at the
    // next unindented line or EOF.
    const lines = PLATFORMIO.split("\n");
    const start = lines.findIndex((l) => /^lib_deps\s*=/.test(l));
    expect(start, "device/platformio.ini must declare lib_deps").toBeGreaterThanOrEqual(0);

    const deps: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() !== "" && !/^\s/.test(line)) break; // next INI key
      deps.push(line.replace(/\s+;.*$/, "").trim()); // strip trailing comments
    }

    // Any URL counts, not only git+ ones: a dependency written as
    // "name=https://..." floats just the same. symlink:// is our own in-tree
    // code and has no ref to pin.
    const unpinned = deps
      .filter((d) => d.includes("://") && !d.startsWith("symlink://"))
      .filter((d) => !/#[0-9a-fA-F]{7,40}$/.test(d));

    expect(
      unpinned,
      "these git dependencies track a moving HEAD; pin each to a commit SHA " +
        "(git+https://host/repo.git#<sha>) so a dependency fetch cannot change firmware behaviour",
    ).toEqual([]);
  });

  // A registry dependency with no version resolves to whatever is newest on
  // the day of the build, and a range (^, ~, >=) to whatever is newest inside
  // it. Each one is pinned to the version the hardware was proved with.
  it("pins every registry dependency to an exact version", () => {
    const lines = PLATFORMIO.split("\n");
    const start = lines.findIndex((l) => /^lib_deps\s*=/.test(l));
    const deps: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      deps.push(line.replace(/\s*;.*$/, "").trim());
    }
    const unversioned = deps
      .filter((d) => d !== "" && !d.includes("://"))
      .filter((d) => !/@\d+\.\d+\.\d+$/.test(d));
    expect(
      unversioned,
      "pin an exact version (owner/name@x.y.z, no range) for each registry dependency",
    ).toEqual([]);
  });
});

// Resident v0.8.3 routes a relay message by its "channel" field. An announce
// with no channel takes the legacy path, which logs
//   [deprecated] un-channelled 'story_fetch' message; sender should stamp channel
// and -- once the relay sends channel:"system" type:"hello" -- is dropped
// outright: Sandbox::onCourierMessage closes that path for good the first time
// _hostHelloSeen goes true. OTA delivery would then stop with nothing but a
// serial line to explain it, on a relay-side change this repo does not control.
//
// Stamping a channel makes the announce bypass sandbox.onMessage() entirely,
// so the sender's channel and the firmware's registered channel have to agree
// exactly. Disagreement is silent: Resident logs "no handler for channel" and
// drops the message. Both halves are checked here, against each other.
const SKILL_MD = readFileSync(
  new URL("../.claude/skills/push-story/SKILL.md", import.meta.url).pathname,
  "utf8",
);

// Reserved by Sandbox::onCourierMessage *before* the channel-slot registry is
// consulted, so a handler registered under one of these never fires.
const RESERVED_CHANNELS = ["app", "runtime", "system"];

describe("story_fetch channel routing", () => {
  it("registers a channelled handler for story_fetch on a non-reserved channel", () => {
    const m = MAIN_CPP.match(/sandbox\.onMessageWithChannel\(\s*"([^"]+)"[\s\S]{0,400}?story_fetch/);
    expect(
      m,
      'device/src/main.cpp must register sandbox.onMessageWithChannel("<channel>", ...) ' +
        "handling story_fetch; under Resident v0.8.3 a channelled announce never reaches " +
        "the legacy sandbox.onMessage() hook, so without this OTA delivery silently stops",
    ).not.toBeNull();
    expect(
      RESERVED_CHANNELS,
      `channel "${m?.[1]}" is reserved by Resident and is checked before the channel-slot ` +
        "registry, so a handler registered under it would never fire",
    ).not.toContain(m![1]);
  });

  it("stamps that same channel on every push-story announce", () => {
    const channel = MAIN_CPP.match(
      /sandbox\.onMessageWithChannel\(\s*"([^"]+)"[\s\S]{0,400}?story_fetch/,
    )?.[1];
    expect(channel, "no channelled story_fetch handler in main.cpp").toBeTruthy();

    // Every jq line in the skill that builds a story_fetch announce.
    const announces = SKILL_MD.split("\n").filter((l) => /type:"story_fetch"/.test(l));
    expect(
      announces.length,
      "expected the push-story skill to build the story_fetch announce (step 6 and its worked example)",
    ).toBeGreaterThanOrEqual(2);

    const unstamped = announces.filter((l) => !new RegExp(`channel:"${channel}"`).test(l));
    expect(
      unstamped,
      `every story_fetch announce in .claude/skills/push-story/SKILL.md must stamp ` +
        `channel:"${channel}" to match the handler registered in device/src/main.cpp; ` +
        "an un-channelled announce is deprecated now and dropped once the relay speaks hello, " +
        "and a mismatched one is dropped immediately with only a serial line",
    ).toEqual([]);
  });
});
