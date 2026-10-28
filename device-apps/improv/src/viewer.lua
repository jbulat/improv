-- viewer: cycle actors and expressions; the mouth flaps continuously so
-- both frames of every pair can be checked. Btn0 = next expression,
-- Btn1 = next actor. Portrait layout: text top, sprite grounded below
-- (miss_moon in the sky) -- doubles as an on-device placement check.

local actors = {}
local names = {}
local ai, ei = 1, 1

local function build_names()
  for id in pairs(S.sprites) do
    actors[#actors + 1] = id
  end
  table.sort(actors) -- pairs() order is undefined; sort so cycling is deterministic
  for _, id in ipairs(actors) do
    local list = {}
    for key in pairs(S.sprites[id].expr) do
      local base = string.match(key, "^(.+)_closed$")
      if base then list[#list + 1] = base end
    end
    table.sort(list)
    names[id] = list
  end
end

local function draw(mouth_open)
  local id = actors[ai]
  local expr = names[id][ei]
  screen.clear(26, 28, 44)
  S.place_character(id, expr, mouth_open)
  -- All text lives at the top: the grounded sprite owns the bottom of the
  -- portrait screen, and the feet/baseline must stay unobstructed. Top text
  -- may overlap miss_moon's upper rows; it draws last and stays legible.
  screen.text(2, 2, id .. " / " .. expr, 1, 244, 244, 244)
  screen.text(2, 13, "Btn0: expression", 1, 148, 176, 194)
  screen.text(2, 24, "Btn1: actor", 1, 148, 176, 194)
  screen.flip()
end

-- Mouth-flap clock, accumulated from dt_ms as player.lua does: the device
-- lifecycle (DEVICE-SKILL.md) passes dt_ms and documents no clock on ctx.
local elapsed_ms = 0

function init(ctx)
  -- Same art-error contract as main.lua: the device prelude sets S.art_error
  -- when the resident troupe is absent, mismatched, or fails to install, and
  -- S.sprites is then nil. The local sim regenerates its stub on every start,
  -- so only a viewer pushed to stale firmware reaches this.
  if S.art_error then
    S.draw_art_error()
    return
  end
  S.init_sprites()
  build_names()
  elapsed_ms = 0
  draw(false)
end

function on_tick(ctx, dt_ms)
  if S.art_error then return end
  elapsed_ms = elapsed_ms + (dt_ms or 0)
  draw((math.floor(elapsed_ms / 400) % 2) == 1)
end

function on_event(ctx, e)
  if S.art_error then return end
  if e.name ~= "button" then return end
  if e.data.index == 0 then
    ei = ei + 1
    if ei > #names[actors[ai]] then ei = 1 end
  else
    ai = ai + 1
    if ai > #actors then ai = 1 end
    ei = 1
  end
end
