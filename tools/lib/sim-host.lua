-- Simulator host environment: the same screen/button/buzzer/audio surface
-- tests/lua/stubs.lua provides headlessly, wired to a panel instead of to
-- assertions. tools/sim.ts prepends this to a built bundle and appends a
-- __sim_main() trailer.
--
-- Upstream (to Node): one JSON array per line.
-- Downstream (from Node): terse lines -- "t <dt>", "b <index>", "r <value>",
-- "q" -- so this file needs no JSON parser.

-- The host keeps the few library functions it needs as locals: the device's
-- sandbox removes os, io, debug and the loaders before an app runs, and the
-- end of this file does the same here.
local host_stdout, host_stdin = io.stdout, io.stdin
local host_exit, host_traceback = os.exit, debug.traceback

host_stdout:setvbuf("line")

local SCREEN_W, SCREEN_H = 135, 240

local function jstr(s)
  s = tostring(s)
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  s = s:gsub("%c", function(c) return string.format("\\u%04x", c:byte()) end)
  return '"' .. s .. '"'
end

-- inf and nan are not valid JSON, and both are app bugs. They are emitted as
-- `null`, which every consumer treats as "did not draw", and emit() logs the
-- offending call. "1e999" would parse back as Infinity and can hang an
-- unbounded rasterizer loop; a finite stand-in such as 0 draws a believable
-- but wrong picture.
local function is_nonfinite(v)
  return type(v) == "number" and (v ~= v or v == math.huge or v == -math.huge)
end

local function jval(v)
  local t = type(v)
  if t == "string" then return jstr(v) end
  if t == "boolean" then return tostring(v) end
  if t == "nil" then return "null" end
  if is_nonfinite(v) then return "null" end
  if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
  -- %.14g is not round-trip precise (1/3 -> "0.33333333333333"); %.17g is
  -- enough digits to round-trip any double, which matters once a float
  -- reaches something like audio.play's offset instead of a pixel coordinate.
  return string.format("%.17g", v)
end

local function emit(...)
  local n = select("#", ...)
  -- For a query, ask() passes the wire marker "?" first and the real name
  -- second, so the log line names the actual call (e.g. "audio.play").
  local opname = tostring((select(1, ...)))
  if opname == "?" and n >= 2 then
    opname = tostring((select(2, ...)))
  end
  local parts = {}
  local bad = false
  for i = 1, n do
    local v = select(i, ...)
    if is_nonfinite(v) then bad = true end
    parts[i] = jval(v)
  end
  host_stdout:write("[", table.concat(parts, ","), "]\n")
  if bad then
    -- A separate line, so Node reads it as its own ["log", "error", ...] op
    -- right after the op it describes.
    host_stdout:write("[\"log\",\"error\",", jstr("non-finite number passed to " .. opname), "]\n")
  end
end

-- The one and only place a reply line is consumed. Node guarantees a reply
-- arrives before any event, so this can never swallow a tick.
local function ask(...)
  emit("?", ...)
  local line = host_stdin:read("l")
  if not line then host_exit(0) end
  local v = line:match("^r (.*)$")
  if v == nil then return nil end
  if v == "t" then return true end
  if v == "f" then return false end
  return tonumber(v)
end

screen = {
  clear = function(r, g, b) emit("clear", r or 0, g or 0, b or 0) end,
  text = function(x, y, s, size, r, g, b)
    emit("text", x or 0, y or 0, tostring(s), size or 2, r or 255, g or 255, b or 255)
  end,
  fill_rect = function(x, y, w, h, r, g, b)
    emit("fill_rect", x or 0, y or 0, w or 0, h or 0, r or 255, g or 255, b or 255)
  end,
  rect = function(x, y, w, h, r, g, b)
    emit("rect", x or 0, y or 0, w or 0, h or 0, r or 255, g or 255, b or 255)
  end,
  line = function(x0, y0, x1, y1, r, g, b)
    emit("line", x0 or 0, y0 or 0, x1 or 0, y1 or 0, r or 255, g or 255, b or 255)
  end,
  pixel = function(x, y, r, g, b)
    emit("pixel", x or 0, y or 0, r or 255, g or 255, b or 255)
  end,
  triangle = function(x0, y0, x1, y1, x2, y2, r, g, b)
    emit("triangle", x0 or 0, y0 or 0, x1 or 0, y1 or 0, x2 or 0, y2 or 0, r or 255, g or 255, b or 255)
  end,
  fill_triangle = function(x0, y0, x1, y1, x2, y2, r, g, b)
    emit("fill_triangle", x0 or 0, y0 or 0, x1 or 0, y1 or 0, x2 or 0, y2 or 0, r or 255, g or 255, b or 255)
  end,
  qr = function(x, y, data, scale, r, g, b)
    emit("qr", x or 0, y or 0, tostring(data), scale or 4, r or 0, g or 0, b or 0)
  end,
  set_brightness = function(v) emit("brightness", v or 255) end,
  flip = function() emit("flip") end,
  width = function() return SCREEN_W end,
  height = function() return SCREEN_H end,
}

buzzer = {
  beep = function(f, d) emit("beep", f or 440, d or 100) end,
  tone = function(f) emit("tone", f or 440) end,
  stop = function() emit("tone_stop") end,
}

audio = {
  preload = function(p) return ask("audio.preload", tostring(p)) end,
  play = function(p, ch, off) return ask("audio.play", tostring(p), ch or 0, off or 0) end,
  stop = function(ch) emit("audio.stop", ch or -1) end,
  is_playing = function(ch) return ask("audio.is_playing", ch or 0) end,
  set_volume = function(v) emit("audio.set_volume", v or 255) end,
}

button = {
  press_count = function() return ask("button.press_count") end,
}

log = {
  info = function(m) emit("log", "info", tostring(m)) end,
  warn = function(m) emit("log", "warn", tostring(m)) end,
  error = function(m) emit("log", "error", tostring(m)) end,
}

local ctx = {}

-- A crash paints a traceback and exits non-zero rather than rebooting, which
-- is the simulator's main debugging advantage over the hardware.
local function guard(fn, ...)
  if type(fn) ~= "function" then return end
  local ok, err = xpcall(fn, host_traceback, ...)
  if not ok then
    emit("error", tostring(err))
    host_stdout:flush()
    host_exit(1)
  end
end

function __sim_main()
  guard(init, ctx)
  emit("idle")
  while true do
    local line = host_stdin:read("l")
    if not line then return end
    local kind, arg = line:match("^(%a)%s?(.*)$")
    if kind == "t" then
      guard(on_tick, ctx, tonumber(arg) or 100)
    elseif kind == "b" then
      -- No ts_ms: the simulator has no clock (ctx is empty), and no shipped
      -- app reads ts_ms.
      guard(on_event, ctx, {
        name = "button",
        from = "",
        channel = "driver",
        data = { index = tonumber(arg) or 0 },
      })
    elseif kind == "q" then
      return
    end
    emit("idle")
  end
end

-- ResidentSandbox's kUnsafeGlobals: an app that reaches for one of these fails
-- here as it would on the device, rather than working only in the sim.
-- composeApp calls this after the host code (this file and the stand-ins for
-- the firmware's native drivers) and before the app.
function __sim_sandbox()
  for _, name in ipairs({ "os", "io", "package", "require", "dofile", "load", "loadstring", "loadfile", "debug" }) do
    _G[name] = nil
  end
  __sim_sandbox = nil
end
