-- audio-check: audio driver exercise. Preloads two real clips and one missing
-- one (expect a warn on serial), then: Btn0 = narration clip on channel 0,
-- Btn1 = sfx on channel 1 (press during Btn0 audio to hear the mix).
local ROOT = "stories/knight-and-lonely-dragon"
local status = "preloading..."

function init(ctx)
  local a = audio.preload(ROOT .. "/aud_001.wav")
  local b = audio.preload(ROOT .. "/sfx_chime.wav")
  local c = audio.preload(ROOT .. "/nope.wav") -- must be false, not a crash
  status = string.format("pre a=%s b=%s missing=%s", tostring(a), tostring(b), tostring(c))
end

function on_tick(ctx, dt_ms)
  screen.clear(26, 28, 44)
  screen.text(4, 8, "AUDIO CHECK", 2, 255, 205, 117)
  screen.text(4, 40, status, 1, 244, 244, 244)
  screen.text(4, 60, "line ch0: " .. tostring(audio.is_playing(0)), 1, 148, 176, 194)
  screen.text(4, 74, "sfx  ch1: " .. tostring(audio.is_playing(1)), 1, 148, 176, 194)
  screen.text(4, 110, "Btn0: line  Btn1: sfx", 1, 148, 176, 194)
  screen.flip()
end

function on_event(ctx, e)
  if e.name ~= "button" then return end
  if e.data.index == 0 then
    audio.play(ROOT .. "/aud_001.wav", 0)
  else
    audio.play(ROOT .. "/sfx_chime.wav", 1)
  end
end
