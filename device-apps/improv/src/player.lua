-- player: the beat-walker. Pure timing/state; drawing lives in main.lua.
--
-- Sound-layer contract: the bundler concatenates audio.lua ahead of this
-- chunk, and it must define all six hooks the player calls:
--   S.preload_clips()             queue everything the story will need
--   S.sfx_trigger(id)             fire one sfx now
--   S.sfx_update(dt_ms)           per-tick pump (drains that queue on device)
--   S.line_start(beat)            a beat began: start its line, if any
--   S.line_resume(beat, offset_ms) unpause: rejoin the line mid-clip
--   S.sound_stop()                silence everything (reset/pause)

local TITLE_MS = 2000

-- dt_ms is unclamped wall-clock: Courier's autoConnect() blocks the first
-- loop for up to ~20 s and it all lands on the first tick. A stall must not
-- teleport the story forward, so charge it as one ordinary tick.
local MAX_DT_MS = 1000
local NOMINAL_DT_MS = 100

S.p = { state = "title", beat_i = 1, elapsed = 0, sfx_next = 1 }

function S.player_reset()
  S.p.state = "title"
  S.p.beat_i = 1
  S.p.elapsed = 0
  S.p.sfx_next = 1
  S.sound_stop()
  S.sfx_trigger("sfx_chime")
end

-- Cold boot: hold the title until someone asks for the story. init() has
-- already run player_reset, so the queued chime is cut here -- the chime
-- belongs to the story starting, and the story has not started yet.
function S.player_hold()
  S.p.state = "ready"
  S.p.beat_i = 1
  S.p.elapsed = 0
  S.p.sfx_next = 1
  S.sound_stop()
end

-- Ordering matters: advance to the beat this tick lands on, then fire that
-- beat's cues against the same elapsed the frame will be drawn with, so a cue
-- at offset 0 sounds on this tick rather than a full 100 ms tick later. The
-- sound-layer pump (clip preloads on device) runs last, after the cues.
function S.player_update(dt_ms)
  local p = S.p
  if p.state == "paused" or p.state == "done" or p.state == "ready" then return end
  if dt_ms > MAX_DT_MS then dt_ms = NOMINAL_DT_MS end
  p.elapsed = p.elapsed + dt_ms

  if p.state == "title" then
    if p.elapsed < TITLE_MS then
      S.sfx_update(dt_ms)
      return
    end
    -- Title just expired: this tick already draws beat 1, so it evaluates
    -- beat 1's cues too rather than deferring them a tick.
    p.state = "playing"
    p.elapsed = p.elapsed - TITLE_MS
    p.beat_i = 1
    p.sfx_next = 1
    S.line_start(S.performance.beats[1])
  end

  local beats = S.performance.beats
  local beat = beats[p.beat_i]
  while p.elapsed >= beat.duration do
    p.elapsed = p.elapsed - beat.duration
    if p.beat_i >= #beats then
      p.state = "done"
      break
    end
    p.beat_i = p.beat_i + 1
    p.sfx_next = 1
    beat = beats[p.beat_i]
    S.line_start(beat)
  end

  if p.state == "playing" then
    while beat.sfx[p.sfx_next] and p.elapsed >= beat.sfx[p.sfx_next].at do
      S.sfx_trigger(beat.sfx[p.sfx_next].id)
      p.sfx_next = p.sfx_next + 1
    end
  end

  S.sfx_update(dt_ms)
end

function S.player_button(index)
  -- A held story starts on any button: the device has just been switched on
  -- and "press to play" should not require the right one.
  if S.p.state == "ready" then
    S.player_reset()
    return
  end
  if index == 0 then
    S.player_reset()
  elseif index == 1 then
    if S.p.state == "playing" then
      S.p.state = "paused"
      S.sound_stop()
    elseif S.p.state == "paused" then
      S.p.state = "playing"
      S.line_resume(S.performance.beats[S.p.beat_i], S.p.elapsed)
    end
  end
end

-- The mouth opens on alternating 200 ms windows while the line is playing
-- (elapsed < line_ms).
function S.mouth_open()
  local p = S.p
  if p.state ~= "playing" then return false end
  local beat = S.performance.beats[p.beat_i]
  if beat.animation ~= "speak" or not beat.line_ms then return false end
  if p.elapsed >= beat.line_ms then return false end
  return (math.floor(p.elapsed / 200) % 2) == 1
end
