-- Cold-boot restore behaviour. In "hold" mode the firmware announces
-- boot_restore and the story must wait for a press; in "auto" mode nothing is
-- announced and the story must play on its own, which is what a fresh push
-- from /push-story relies on.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end
dofile(arg[1])

local mode = arg[3] or "hold"
-- Which button wakes a held story. Defaults to 1; a second run with 0 proves
-- "any button" empirically rather than only ever exercising the one index
-- that happens to need the ready special-case in player_button.
local button_index = tonumber(arg[4]) or 1
local ctx = { time_ms = 0 }

local function ticks(n)
  for _ = 1, n do
    ctx.time_ms = ctx.time_ms + 100
    on_tick(ctx, 100)
  end
end

local function send(name, data)
  on_event(ctx, { name = name, data = data or {}, ts_ms = ctx.time_ms, from = "" })
end

-- Line clips play on channel 0; sfx cues play on channel 1.
local function plays_on(channel)
  local n = 0
  for i = 1, #audio.plays do
    if audio.plays[i][2] == channel then n = n + 1 end
  end
  return n
end

-- "stall" mode: no boot_restore at all, then a single tick carrying a
-- multi-second dt_ms -- what the device really sees when Courier's blocking
-- autoConnect() holds the first loop(). Unclamped that one tick walks straight
-- through the 2 s title and fires a line_start per beat crossed.
if mode == "stall" then
  init(ctx)
  local lines_after_init = plays_on(0)
  ctx.time_ms = ctx.time_ms + 20000
  on_tick(ctx, 20000)
  print("AFTER_STALL " .. S.p.state .. ":" .. S.p.beat_i)
  print("ELAPSED_AFTER_STALL " .. S.p.elapsed)
  print("LINES_FROM_STALL " .. (plays_on(0) - lines_after_init))
  do return end
end

init(ctx)
print("AFTER_INIT " .. S.p.state)
-- init() already ran player_reset(), which itself calls sound_stop() --
-- so a bare "was anything ever stopped" check can't tell player_hold()'s
-- own sound_stop() apart from that one. Compare the count on either side
-- of the event instead: it must move in "hold" mode and must not move in
-- "auto" mode, where no event is sent at all.
local stops_after_init = #audio.stops

if mode == "hold" then send("boot_restore") end
print("AFTER_EVENT " .. S.p.state)
print("STOPS_AFTER_INIT " .. stops_after_init)
print("STOPS_AFTER_EVENT " .. #audio.stops)

-- 4 s, comfortably past the 2 s title.
ticks(40)
print("AFTER_WAIT " .. S.p.state .. ":" .. S.p.beat_i)
print("LINES_BEFORE_PRESS " .. plays_on(0))

-- A held story must render its title, not beat 1. on_tick routes every state
-- that is not title/done to draw_beat, so `ready` must join that list --
-- audio alone would not catch that, since drawing a beat makes no sound.
local hinted = false
for i = 1, #screen.texts do
  if screen.texts[i] == "Press to play" then hinted = true end
end
print("HINT_DRAWN " .. tostring(hinted))

send("button", { index = button_index })
print("AFTER_PRESS " .. S.p.state)

ticks(25) -- through the title into beat 1
print("AFTER_PRESS_TICKS " .. S.p.state .. ":" .. S.p.beat_i)
print("LINES_AFTER_PRESS " .. plays_on(0))
