-- audio: the sound layer (see player.lua's six-hook contract). Narration
-- and sfx play as WAV clips through the audio driver. Channel 0 = narration
-- line, channel 1 = sfx; the speaker mixes them. The beat clock, not the
-- clip, owns time: pause stops sound; resume replays the current line clip
-- from the mid-beat offset so audio rejoins in sync (silent only if the
-- line already ended).

local function clip_path(id)
  return S.performance.audio_root .. "/" .. id .. ".wav"
end

-- Loading every clip in init() would block the app-load dispatch (~1.7 s for
-- 22 clips on hardware), so clips drain a few per tick across the title.
local PRELOAD_PER_TICK = 4
local next_clip = 1

function S.preload_clips()
  next_clip = 1
end

-- Warm before playing: player_reset fires the title chime from inside init(),
-- before any tick has drained. A cold play still works but stalls that
-- dispatch, and preload of an already-warm clip is a driver cache hit.
function S.sfx_trigger(id)
  local path = clip_path(id)
  audio.preload(path)
  audio.play(path, 1)
end

function S.sfx_update(dt_ms)
  local clips = S.performance.clips
  for _ = 1, PRELOAD_PER_TICK do
    if next_clip > #clips then return end
    audio.preload(clip_path(clips[next_clip]))
    next_clip = next_clip + 1
  end
end

function S.line_start(beat)
  audio.stop(0)
  if beat.line then
    audio.play(clip_path(beat.line), 0)
  end
end

function S.sound_stop()
  audio.stop()
end

function S.line_resume(beat, offset_ms)
  -- The driver knows the staged clip's real length and refuses an offset past
  -- its end, so it is the single authority on whether there is audio left to
  -- rejoin -- not the authored line_ms, which can drift from the file.
  if beat.line then
    audio.play(clip_path(beat.line), 0, offset_ms)
  end
end
