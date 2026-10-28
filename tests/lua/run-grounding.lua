-- Placement probe: draw every baked actor via S.place_character and report
-- the lowest fill_rect edge. Grounded actors must land exactly on
-- S.BASELINE_Y; miss_moon hangs from S.MOON_Y.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end  -- troupe stub (the viewer installs resident art)
dofile(arg[1]) -- a built viewer bundle: S.sprites = every actor with art
S.init_sprites()
local ids = {}
for id in pairs(S.sprites) do ids[#ids + 1] = id end
table.sort(ids)
for _, id in ipairs(ids) do
  screen.max_fill_bottom = 0
  screen.min_fill_x = 10000
  screen.max_fill_right = 0
  S.place_character(id, "neutral", false)
  print("BOTTOM " .. id .. " " .. screen.max_fill_bottom)
  print("SPAN " .. id .. " " .. screen.min_fill_x .. " " .. screen.max_fill_right)
end
print("BASELINE " .. S.BASELINE_Y)
