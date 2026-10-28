-- Drives the device bundle headlessly and checks every recorded audio call
-- against the bundle's own baked data.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end  -- troupe stub (device apps install resident art)
dofile(arg[1])

-- Ordering between preloads and plays is the property that matters, because
-- preloading is spread across ticks: a clip must be warm BEFORE it is played,
-- and the stub's two separate arrays cannot show that. Wrap both to get one
-- ordered log.
local ordered = {}
local raw_preload, raw_play = audio.preload, audio.play
audio.preload = function(p)
  ordered[#ordered + 1] = { "preload", p }
  return raw_preload(p)
end
audio.play = function(p, ch, off)
  ordered[#ordered + 1] = { "play", p }
  return raw_play(p, ch, off)
end

-- Plays of a clip that was never preloaded before that point. On device such a
-- play still works -- audio.play loads on demand -- but it stalls the dispatch
-- it happens on, which is the whole thing spreading the preload is meant to
-- avoid.
local function unpreloaded_plays()
  local warm, misses = {}, {}
  for i = 1, #ordered do
    local kind, path = ordered[i][1], ordered[i][2]
    if kind == "preload" then
      warm[path] = true
    elseif not warm[path] then
      misses[#misses + 1] = path
    end
  end
  return misses
end

-- How much of the clip manifest is warm. Counted distinctly, because
-- sfx_trigger warms on use and the drain warms again -- a raw call count
-- double-counts the chime and says nothing about coverage.
local function manifest_warm()
  local warm, n = {}, 0
  for i = 1, #audio.preloads do warm[audio.preloads[i]] = true end
  for i = 1, #S.performance.clips do
    if warm[S.performance.audio_root .. "/" .. S.performance.clips[i] .. ".wav"] then
      n = n + 1
    end
  end
  return n
end

local ctx = { time_ms = 0 }
init(ctx)

-- init() only queues. The one clip warm here is the title chime, which
-- player_reset fires from inside init() and sfx_trigger warms before playing.
print("WARM_AT_INIT " .. manifest_warm() .. " " .. #S.performance.clips)

local function ticks(n)
  for _ = 1, n do
    ctx.time_ms = ctx.time_ms + 100
    on_tick(ctx, 100)
  end
end
local function press(i)
  on_event(ctx, { name = "button", data = { index = i }, ts_ms = ctx.time_ms, from = "" })
end

ticks(20) -- exactly the 2 s title: the queue must be drained by its end
print("WARM_AFTER_TITLE " .. manifest_warm() .. " " .. #S.performance.clips)
print("DRAIN_FIRST " .. audio.preloads[2])  -- [1] is the chime, warmed on use

ticks(5) -- on into beat 1
-- First play is the reset chime on the sfx channel; beat 1's line follows on 0.
print("FIRST_PLAY " .. audio.plays[1][1] .. " " .. audio.plays[1][2])
local line1 = nil
for i = 1, #audio.plays do
  if audio.plays[i][2] == 0 then line1 = audio.plays[i][1] break end
end
print("LINE1 " .. tostring(line1))

press(1) -- pause must stop all channels
print("PAUSE_STOP_ALL " .. tostring(audio.stops[#audio.stops] == -1))
local elapsed_at_pause = S.p.elapsed
press(1) -- resume
-- The resume replay must land immediately: beat 1's line, channel 0, at the
-- elapsed offset frozen by the pause (25 ticks * 100 ms - 2000 ms title).
local rp = audio.plays[#audio.plays]
print("RESUME_PLAY " .. tostring(rp[1]) .. " " .. rp[2] .. " " .. rp[3])
print("ELAPSED_AT_PAUSE " .. elapsed_at_pause)
ticks(480) -- run out the story
print("STATE " .. S.p.state)

-- Across the whole run, the reset chime is the one clip allowed to play cold:
-- player_reset fires it from inside init(), before any tick has drained the
-- queue. Everything else must have been warmed first.
local misses = unpreloaded_plays()
print("UNPRELOADED_COUNT " .. #misses)
print("UNPRELOADED_FIRST " .. tostring(misses[1]))

-- Tally recorded plays against the baked timeline: every beat with a line id
-- played once on channel 0; every sfx cue played once on channel 1 (+1 for
-- the title chime fired by player_reset). The harness does exactly one
-- pause/resume, mid beat 1's line, so beat 1's line plays a second time (the
-- resume replay) on top of its one line_start play -- account for that
-- single deliberate extra play rather than let it silently inflate the
-- tally.
local want_lines, want_sfx = 0, 1
for i = 1, #S.performance.beats do
  local b = S.performance.beats[i]
  if b.line then want_lines = want_lines + 1 end
  want_sfx = want_sfx + #b.sfx
end
want_lines = want_lines + 1 -- the one resume replay from the harness's single pause/resume
local got_lines, got_sfx = 0, 0
for i = 1, #audio.plays do
  if audio.plays[i][2] == 0 then got_lines = got_lines + 1 else got_sfx = got_sfx + 1 end
end
print("LINES " .. got_lines .. " " .. want_lines)
print("SFX " .. got_sfx .. " " .. want_sfx)
