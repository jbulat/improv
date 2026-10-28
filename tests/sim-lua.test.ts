import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { LuaHost, composeApp } from "../tools/lib/sim-lua";
import type { Op } from "../tools/lib/sim-raster";

/** Write a composed app to a temp file and return its path. */
function appFile(source: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sim-lua-"));
  const file = path.join(dir, "app.lua");
  writeFileSync(file, composeApp(source));
  return file;
}

const COUNTER_APP = `
local n = 0
function init(ctx)
  screen.clear(1, 2, 3)
  screen.text(4, 5, "HI", 2, 9, 8, 7)
  screen.flip()
end
function on_tick(ctx, dt_ms)
  n = n + 1
  screen.fill_rect(0, 0, dt_ms, n, 1, 1, 1)
  screen.flip()
end
function on_event(ctx, e)
  if e.name == "button" then buzzer.beep(440 + e.data.index, 50) end
end
`;

describe("LuaHost", () => {
  it("runs init before the first idle and reports its ops", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(appFile(COUNTER_APP), {
      onOp: (op) => ops.push(op),
      onQuery: () => true,
    });
    expect(ops[0]).toEqual(["clear", 1, 2, 3]);
    expect(ops[1]).toEqual(["text", 4, 5, "HI", 2, 9, 8, 7]);
    expect(ops[2]).toEqual(["flip"]);
    expect(ops).not.toContainEqual(["idle"]);
    await host.quit();
  });

  it("delivers dt_ms to on_tick and resolves only once the tick is finished", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(appFile(COUNTER_APP), {
      onOp: (op) => ops.push(op),
      onQuery: () => true,
    });
    ops.length = 0;
    await host.tick(101);
    expect(ops).toEqual([["fill_rect", 0, 0, 101, 1, 1, 1, 1], ["flip"]]);
    await host.tick(99);
    expect(ops).toContainEqual(["fill_rect", 0, 0, 99, 2, 1, 1, 1]);
    await host.quit();
  });

  it("delivers button events with their index", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(appFile(COUNTER_APP), {
      onOp: (op) => ops.push(op),
      onQuery: () => true,
    });
    ops.length = 0;
    await host.button(1);
    expect(ops).toEqual([["beep", 441, 50]]);
    await host.quit();
  });

  it("answers queries synchronously from Lua's point of view", async () => {
    const asked: [string, (string | number)[]][] = [];
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          local ok = audio.preload("stories/x/a.wav")
          local playing = audio.is_playing(1)
          local n = button.press_count()
          screen.text(0, 0, tostring(ok) .. "," .. tostring(playing) .. "," .. tostring(n), 1, 0, 0, 0)
          screen.flip()
        end
      `),
      {
        onOp: (op) => ops.push(op),
        onQuery: (name, args) => {
          asked.push([name, args]);
          if (name === "audio.preload") return true;
          if (name === "audio.is_playing") return false;
          return 7;
        },
      },
    );
    expect(asked).toEqual([
      ["audio.preload", ["stories/x/a.wav"]],
      ["audio.is_playing", [1]],
      ["button.press_count", []],
    ]);
    expect(ops[0]).toEqual(["text", 0, 0, "true,false,7", 1, 0, 0, 0]);
    await host.quit();
  });

  it("reports screen dimensions without a round trip", async () => {
    const ops: Op[] = [];
    let queries = 0;
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          screen.text(0, 0, screen.width() .. "x" .. screen.height(), 1, 0, 0, 0)
          screen.flip()
        end
      `),
      {
        onOp: (op) => ops.push(op),
        onQuery: () => {
          queries++;
          return 0;
        },
      },
    );
    expect(ops[0]).toEqual(["text", 0, 0, "135x240", 1, 0, 0, 0]);
    expect(queries).toBe(0);
    await host.quit();
  });

  it("escapes strings so a quote in a subtitle cannot corrupt the stream", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          screen.text(0, 0, [[a "b" \\ c]], 1, 0, 0, 0)
          screen.flip()
        end
      `),
      { onOp: (op) => ops.push(op), onQuery: () => true },
    );
    expect(ops[0][3]).toBe('a "b" \\ c');
    await host.quit();
  });

  it("surfaces a Lua error as a traceback instead of hanging", async () => {
    const host = await LuaHost.start(appFile(`function init(ctx) error("boom") end`), {
      onOp: () => {},
      onQuery: () => true,
    });
    expect(host.crashed).toBeTruthy();
    expect(host.crashed).toContain("boom");
    expect(host.crashed).toContain("stack traceback");
    const { code } = await host.quit();
    expect(code).toBe(1);
  });

  // The device's Resident sandbox removes these globals before an app runs.
  // An app that used one would work here and crash on the device.
  const UNSAFE = ["os", "io", "package", "require", "dofile", "load", "loadstring", "loadfile", "debug"];
  const KEPT = ["string", "table", "math", "coroutine", "utf8", "collectgarbage", "pcall"];

  it("gives the app the device's sandbox: no os, io, load or debug, the pure libraries kept", async () => {
    const logged: string[] = [];
    const names = [...UNSAFE, ...KEPT].map((n) => JSON.stringify(n)).join(", ");
    const host = await LuaHost.start(
      appFile(`
        local at_load = {}
        for _, n in ipairs({ ${names} }) do at_load[n] = type(_G[n]) end
        function init(ctx)
          for _, n in ipairs({ ${names} }) do log.info(n .. " " .. at_load[n] .. " " .. type(_G[n])) end
        end
      `),
      {
        onOp: (op) => {
          if (op[0] === "log") logged.push(String(op[2]));
        },
        onQuery: () => true,
      },
    );
    expect(host.crashed).toBeNull();
    // Each line is "<name> <type at load> <type in init>".
    for (const n of UNSAFE) expect(logged).toContain(`${n} nil nil`);
    for (const n of KEPT) expect(logged.find((l) => l.startsWith(`${n} `))).not.toMatch(/ nil/);
    await host.quit();
  });

  it("keeps the host working with the unsafe globals gone: queries, errors and quit", async () => {
    const host = await LuaHost.start(
      appFile(`
        function init(ctx) if audio.play("a.wav", 0, 0) then screen.flip() end end
        function on_tick(ctx, dt) error("late boom") end
      `),
      { onOp: () => {}, onQuery: () => true },
    );
    expect(host.crashed).toBeNull();
    await host.tick(100);
    expect(host.crashed).toContain("late boom");
    expect(host.crashed).toContain("stack traceback");
    const { code } = await host.quit();
    expect(code).toBe(1);
  });

  it("tolerates an app with no on_tick or on_event", async () => {
    const host = await LuaHost.start(appFile(`function init(ctx) screen.flip() end`), {
      onOp: () => {},
      onQuery: () => true,
    });
    await host.tick(100);
    await host.button(0);
    const { code } = await host.quit();
    expect(code).toBe(0);
  });

  it("registers the close listener once, not once per tick", async () => {
    const warnings: Error[] = [];
    const onWarning = (w: Error) => warnings.push(w);
    process.on("warning", onWarning);
    try {
      const host = await LuaHost.start(appFile(COUNTER_APP), {
        onOp: () => {},
        onQuery: () => true,
      });
      // A listener added per tick would raise MaxListenersExceededWarning
      // past Node's default limit of 10; 30 ticks is well past that.
      for (let i = 0; i < 30; i++) {
        await host.tick(16);
      }
      const child = (host as unknown as { child: { listenerCount(event: string): number } }).child;
      expect(child.listenerCount("close")).toBe(1);
      await host.quit();
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter((w) => w.name === "MaxListenersExceededWarning")).toEqual([]);
  });

  it("keeps ticking and reports the failure when onQuery throws, instead of hanging", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          local ok = audio.preload("stories/x/a.wav")
          screen.text(0, 0, tostring(ok), 1, 0, 0, 0)
          screen.flip()
        end
      `),
      {
        onOp: (op) => ops.push(op),
        onQuery: () => {
          throw new Error("boom-query");
        },
      },
    );
    // init() ran to completion -- proof tick()/start() did not deadlock
    // waiting on a reply that was never written.
    expect(ops).toContainEqual(["text", 0, 0, "false", 1, 0, 0, 0]);
    // The throw is not silently swallowed: it shows up on the same onOp
    // channel the caller already watches.
    expect(
      ops.some((op) => op[0] === "log" && op[1] === "error" && String(op[2]).includes("boom-query")),
    ).toBe(true);
    await host.quit();
  });

  it("surfaces a clear, non-fatal error when the lua binary is missing", async () => {
    const host = await LuaHost.start(
      appFile(`function init(ctx) end`),
      { onOp: () => {}, onQuery: () => true },
      "definitely-not-a-real-lua-binary-xyz",
    );
    expect(host.crashed).toBeTruthy();
    expect(host.crashed).toContain("lua");
    expect(host.crashed?.toLowerCase()).toContain("path");
    const { code } = await host.quit();
    expect(code).not.toBe(0);
  });

  it("folds a Lua compile error into `crashed` instead of leaving it null", async () => {
    const host = await LuaHost.start(
      // Missing closing paren: fails to compile before any of init()/the
      // read loop ever runs, so no ["error", ...] line is ever emitted.
      appFile(`function init(ctx screen.flip() end`),
      { onOp: () => {}, onQuery: () => true },
    );
    expect(host.crashed).toBeTruthy();
    const { code, stderr } = await host.quit();
    expect(code).not.toBe(0);
    expect(stderr).not.toBe("");
    expect(host.crashed).toBe(stderr.trim());
  });

  it("writes the query reply before reporting the failure, so a throwing onOp cannot strand the waiter", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          local ok = audio.preload("stories/x/a.wav")
          screen.text(0, 0, tostring(ok), 1, 0, 0, 0)
          screen.flip()
        end
      `),
      {
        // onOp throws on every call, including the ["log","error",...]
        // report from the onQuery catch. If onOp ran before "r f" was
        // written, this throw would escape before the reply reached Lua's
        // blocked io.stdin:read, and init() would never finish.
        onOp: (op) => {
          ops.push(op);
          throw new Error("onOp-boom");
        },
        onQuery: () => {
          throw new Error("query-boom");
        },
      },
    );
    // init() ran to completion -- the "text" op (which comes *after* the
    // failed query) was recorded, proving the reply was written despite
    // onOp throwing on the report.
    expect(ops.some((op) => op[0] === "text" && op[3] === "false")).toBe(true);
    await host.quit();
  });

  it("does not crash or hang when onOp throws on the ordinary draw path", async () => {
    let calls = 0;
    const host = await LuaHost.start(appFile(COUNTER_APP), {
      onOp: () => {
        calls++;
        throw new Error("draw-boom");
      },
      onQuery: () => true,
    });
    // init()'s clear/text/flip ops already went through the throwing onOp
    // above without an uncaught exception taking the test process down.
    expect(calls).toBeGreaterThan(0);
    const before = calls;
    // A further tick() must still resolve -- proof a throwing onOp on the
    // ordinary draw path cannot strand tick()'s pending idle wait either.
    await host.tick(50);
    expect(calls).toBeGreaterThan(before);
    await host.quit();
  });

  it("turns a non-finite draw argument into null plus a loud log line, and the call still returns", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          screen.fill_rect(0, 0, math.huge, 10, 1, 1, 1)
          screen.flip()
        end
        function on_tick(ctx, dt_ms)
          screen.fill_rect(0, 0, 0/0, 10, 1, 1, 1)
          screen.flip()
        end
      `),
      { onOp: (op) => ops.push(op), onQuery: () => true },
    );
    // init() returned -- the fill_rect line carries `null` where math.huge
    // was, not a value JSON.parse would turn into Infinity.
    expect(ops).toContainEqual(["fill_rect", 0, 0, null, 10, 1, 1, 1]);
    expect(
      ops.some((op) => op[0] === "log" && op[1] === "error" && String(op[2]).includes("fill_rect")),
    ).toBe(true);

    ops.length = 0;
    // tick() -- the render call -- must also return rather than hang when
    // on_tick draws with a NaN coordinate.
    await host.tick(16);
    expect(ops).toContainEqual(["fill_rect", 0, 0, null, 10, 1, 1, 1]);
    expect(
      ops.some((op) => op[0] === "log" && op[1] === "error" && String(op[2]).includes("fill_rect")),
    ).toBe(true);
    await host.quit();
  });

  it("treats a JSON-valid non-array line as app output instead of crashing on op[0]", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          print("null")
          print("42")
          print('{"a":1}')
          screen.flip()
        end
      `),
      { onOp: (op) => ops.push(op), onQuery: () => true },
    );
    // Each of these parses as valid JSON to null / 42 / a plain object --
    // none is an array, so op[0] must not be read off any of them.
    expect(ops).toContainEqual(["log", "info", "null"]);
    expect(ops).toContainEqual(["log", "info", "42"]);
    expect(ops).toContainEqual(["log", "info", '{"a":1}']);
    // The flip() after them still arrived -- proof the line handler kept
    // running instead of throwing and taking the process down.
    expect(ops).toContainEqual(["flip"]);
    await host.quit();
  });

  it("exposes exited without conflating it with crashed after a clean exit mid-tick", async () => {
    // An app cannot exit (the sandbox removes os), so a stand-in child that
    // speaks the line protocol does it: idle after init, then exit 0 when the
    // tick arrives.
    const dir = mkdtempSync(path.join(tmpdir(), "sim-lua-"));
    const child = path.join(dir, "exits.lua");
    writeFileSync(child, `io.stdout:setvbuf("line")\nprint('["idle"]')\nio.stdin:read("l")\nos.exit(0)\n`);
    const host = await LuaHost.start(child, { onOp: () => {}, onQuery: () => true });
    // Alive right after a clean init(): neither signal fires early.
    expect(host.exited).toBe(false);
    expect(host.crashed).toBeNull();
    // A clean exit mid-tick, not a crash. tick() must still resolve (via the
    // child's close event, since no ["idle"] line is ever emitted once the
    // process has exited).
    await host.tick(16);
    expect(host.exited).toBe(true);
    // A clean exit is not a crash, so callers can tell "the app finished
    // cleanly" from "the app blew up".
    expect(host.crashed).toBeNull();
    await host.quit();
  });

  it("names the actual call in a non-finite log line reached through a query, not the wire marker", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          audio.play("a.wav", 0, 0/0)
          screen.flip()
        end
      `),
      { onOp: (op) => ops.push(op), onQuery: () => true },
    );
    // Every query (audio.play here) goes through ask(), which emits
    // ["?", "audio.play", ...]: argument 1 is always the literal "?". A log
    // line named after argument 1 would read "non-finite number passed to ?"
    // for every query, so it must name the real call.
    const logged = ops.find((op) => op[0] === "log" && op[1] === "error");
    expect(logged).toBeDefined();
    expect(String(logged?.[2])).toContain("audio.play");
    expect(String(logged?.[2])).not.toContain("passed to ?");
    await host.quit();
  });

  it("rejects an onQuery reply that is not a well-formed token instead of injecting a spurious event", async () => {
    const ops: Op[] = [];
    const host = await LuaHost.start(
      appFile(`
        function init(ctx)
          local ok = audio.preload("stories/x/a.wav")
          screen.text(0, 0, tostring(ok), 1, 0, 0, 0)
          screen.flip()
        end
        function on_event(ctx, e)
          if e.name == "button" then buzzer.beep(1000 + e.data.index, 1) end
        end
      `),
      {
        onOp: (op) => ops.push(op),
        // onQuery's declared return type is boolean | number, but nothing
        // enforces that at runtime -- simulate a caller that violates it
        // with a reply containing an embedded newline, which (unguarded)
        // would write a *second* line to Lua's stdin.
        onQuery: () => "1\nb 9" as unknown as number,
      },
    );
    // If the second line ("b 9") had reached Lua's stdin, __sim_main()'s
    // next io.stdin:read would misread it as a real button-9 press and
    // dispatch a synthetic on_event the app never triggered.
    expect(ops.some((op) => op[0] === "beep")).toBe(false);
    // init() still ran to completion with the safe "f" fallback in place of
    // the rejected reply.
    expect(ops).toContainEqual(["text", 0, 0, "false", 1, 0, 0, 0]);
    // The rejection is observable, not silent.
    expect(
      ops.some((op) => op[0] === "log" && op[1] === "error" && String(op[2]).includes("invalid reply")),
    ).toBe(true);
    await host.quit();
  });
});
