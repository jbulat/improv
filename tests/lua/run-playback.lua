-- Drives the full performance headlessly and prints state transitions, sfx
-- play count, and pause/restart probes.
-- Runs the device bundle (the only build), so arg[2] is the troupe stub that
-- stands in for the firmware's resident art.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end
dofile(arg[1])

local line_starts, sound_stops = {}, 0
local raw_line_start, raw_sound_stop = S.line_start, S.sound_stop
S.line_start = function(beat)
  line_starts[#line_starts + 1] = beat.line or "-"
  raw_line_start(beat)
end
S.sound_stop = function()
  sound_stops = sound_stops + 1
  raw_sound_stop()
end

local ctx = { time_ms = 0 }
local transitions = {}
local last = ""

local function record()
  local cur = S.p.state .. ":" .. S.p.beat_i
  if cur ~= last then
    transitions[#transitions + 1] = cur
    last = cur
  end
end

local function ticks(n)
  for i = 1, n do
    ctx.time_ms = ctx.time_ms + 100
    on_tick(ctx, 100)
    record()
  end
end

local function press(i)
  on_event(ctx, { name = "button", data = { index = i }, ts_ms = ctx.time_ms, from = "" })
  record()
end

init(ctx)
record()

ticks(25) -- through the 2 s title into beat 1

press(1) -- pause
local frozen_elapsed = S.p.elapsed
ticks(10)
-- frozen_elapsed ~= 0 guards against a bug that pins elapsed at 0: that would
-- freeze "correctly" for the wrong reason.
print("PAUSE_FROZEN " .. tostring(
  S.p.state == "paused" and S.p.elapsed == frozen_elapsed and frozen_elapsed ~= 0))
press(1) -- resume

ticks(480) -- more than the ~39.5 s remaining
print("STATE " .. S.p.state)
print("TRANSITIONS " .. table.concat(transitions, " "))
-- Every sfx cue is one audio.play on channel 1 (audio.lua plays clips
-- immediately at trigger time; there is no note queue to drain).
local sfx_plays = 0
for i = 1, #audio.plays do
  if audio.plays[i][2] == 1 then sfx_plays = sfx_plays + 1 end
end
print("SFX_PLAYS " .. sfx_plays)
print("LINE_STARTS " .. #line_starts .. " " .. table.concat(line_starts, ","))
print("SOUND_STOPS " .. sound_stops)

-- The portrait layout has no subtitles, so no drawn string should be longer
-- than the widest text it draws ("Button 0: play again", 20 chars).
local max_len = 0
for _, t in ipairs(screen.texts) do
  if #t > max_len then max_len = #t end
end
print("MAX_TEXT_LEN " .. max_len)

press(0) -- restart from done
print("RESTART " .. S.p.state)

-- ---------------------------------------------------------------------------
-- Timing pass: the run above is shifted by its 1 s pause, so replay the story
-- cleanly from the restart and report absolute story ms for every sfx onset
-- and beat transition. The caller checks these against the fixture's own cue
-- points, so a story playing at the wrong speed fails.
-- ---------------------------------------------------------------------------

local onsets = {} -- { id, story ms } for every channel-1 play, in driver order

local raw_play = audio.play
local origin = ctx.time_ms

audio.play = function(p, ch, off)
  if ch == 1 then
    onsets[#onsets + 1] = { string.match(p, "([^/]+)%.wav$"), ctx.time_ms - origin }
  end
  return raw_play(p, ch, off)
end

press(0) -- restart: player_reset fires the title chime as the first cue
origin = ctx.time_ms

local beat_at, done_at, last_beat = {}, -1, -1
for _ = 1, 440 do -- 44 s > 2 s title + 39.44 s of beats
  ctx.time_ms = ctx.time_ms + 100
  on_tick(ctx, 100)
  local story = ctx.time_ms - origin
  if S.p.state == "playing" and S.p.beat_i ~= last_beat then
    last_beat = S.p.beat_i
    beat_at[#beat_at + 1] = S.p.beat_i .. ":" .. story
  elseif S.p.state == "done" and done_at < 0 then
    done_at = story
  end
end

for i = 1, #onsets do
  print(string.format("SFX_ONSET %s %d", onsets[i][1], onsets[i][2]))
end
print("BEAT_AT " .. table.concat(beat_at, " "))
print("DONE_AT " .. done_at)
