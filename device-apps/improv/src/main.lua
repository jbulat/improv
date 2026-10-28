-- main: lifecycle glue + screen layout (portrait 135x240).
-- Actors render at their S.ACTOR_SCALE, grounded on the shared baseline;
-- miss_moon hangs in the sky (S.place_character owns that policy). No
-- subtitles: the audio carries the words. Name top-left; PAUSED top-right.

local BG = { 26, 28, 44 }

-- S.wrap and S.draw_art_error (the resident-art failure panel) live in
-- compositor.lua: the viewer needs them too, and that is the chunk both
-- entries share.

local function draw_title()
  screen.clear(BG[1], BG[2], BG[3])
  local lines = S.wrap(S.performance.title, 11)
  local y = 60
  for i = 1, #lines do
    screen.text(67 - #lines[i] * 6, y, lines[i], 2, 255, 205, 117)
    y = y + 20
  end
  if S.p.state == "ready" then
    screen.text(28, 200, "Press to play", 1, 148, 176, 194)
  end
  screen.flip()
end

local function draw_beat()
  local beat = S.performance.beats[S.p.beat_i]
  local member = S.performance.cast[beat.character]
  screen.clear(BG[1], BG[2], BG[3])
  -- Runtime is forgiving: a beat whose character somehow isn't in the baked
  -- cast draws chrome only, same as a missing overlay snaps to default.
  if member then
    local expr = beat.expression
    if not S.has_expr(member.actor, expr) then expr = member.default_expression end
    -- A beat carrying its own layers has them already resolved against the
    -- cast's (build-time job) -- so it wins outright, including when it is the
    -- empty table that means "wears nothing this beat".
    S.place_character(member.actor, expr, S.mouth_open(), beat.layers or member.layers)
    screen.text(2, 2, member.name, 1, 148, 176, 194)
  end
  if S.p.state == "paused" then
    screen.text(97, 2, "PAUSED", 1, 239, 125, 87)
  end
  screen.flip()
end

local function draw_done()
  screen.clear(BG[1], BG[2], BG[3])
  S.place_character("miss_moon", "happy", false)
  screen.text(25, 150, "The End", 2, 255, 205, 117)
  screen.text(7, 224, "Button 0: play again", 1, 148, 176, 194)
  screen.flip()
end

function init(ctx)
  if S.art_error then
    S.draw_art_error()
    return
  end
  S.init_sprites()
  screen.clear(BG[1], BG[2], BG[3])
  screen.text(19, 116, "Loading story...", 1, 148, 176, 194)
  screen.flip()
  S.preload_clips()
  S.player_reset()
  draw_title()
end

-- Only `ready` reads this. It rests until a press, so a full repaint every
-- tick would redraw an identical title at 10 Hz forever on a battery device.
-- The other states are animating, so they redraw every tick.
local drawn_state = nil

function on_tick(ctx, dt_ms)
  if S.art_error then return end
  S.player_update(dt_ms)
  local state = S.p.state
  if state == "ready" then
    if drawn_state ~= "ready" then draw_title() end
  elseif state == "title" then
    draw_title()
  elseif state == "done" then
    draw_done()
  else
    draw_beat()
  end
  drawn_state = state
end

function on_event(ctx, e)
  if S.art_error then return end
  if e.name == "button" then
    S.player_button(e.data.index)
  elseif e.name == "boot_restore" then
    S.player_hold()
  end
end
