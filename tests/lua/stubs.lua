-- Recording stubs for headless runs of bundled apps.
screen = {
  fill_rects = 0,
  max_fill_bottom = 0, -- max (y + h) seen by fill_rect; harnesses reset it
  min_fill_x = 10000,  -- min x seen by fill_rect; harnesses reset it
  max_fill_right = 0,  -- max (x + w) seen by fill_rect; harnesses reset it
  flips = 0,
  texts = {},
  clear = function() end,
  flip = function() screen.flips = screen.flips + 1 end,
  text = function(x, y, s) screen.texts[#screen.texts + 1] = s end,
  fill_rect = function(x, y, w, h)
    screen.fill_rects = screen.fill_rects + 1
    local b = y + h
    if b > screen.max_fill_bottom then screen.max_fill_bottom = b end
    if x < screen.min_fill_x then screen.min_fill_x = x end
    local r = x + w
    if r > screen.max_fill_right then screen.max_fill_right = r end
  end,
  rect = function() end,
  line = function() end,
  pixel = function() end,
  triangle = function() end,
  fill_triangle = function() end,
  qr = function() end,
  set_brightness = function() end,
  width = function() return 135 end,
  height = function() return 240 end,
}
buzzer = {
  beeps = {},
  beep = function(f, d) buzzer.beeps[#buzzer.beeps + 1] = { f, d } end,
  tone = function() end,
  stop = function() end,
}
log = { info = function() end, warn = function() end, error = function() end }
audio = {
  preloads = {}, -- paths, in call order
  plays = {},    -- { path, channel }
  stops = {},    -- channel, or -1 for stop-all
  preload = function(p)
    audio.preloads[#audio.preloads + 1] = p
    return true
  end,
  play = function(p, ch, off)
    audio.plays[#audio.plays + 1] = { p, ch or 0, off or 0 }
    return true
  end,
  stop = function(ch) audio.stops[#audio.stops + 1] = ch or -1 end,
  is_playing = function() return false end,
  set_volume = function() end,
}
