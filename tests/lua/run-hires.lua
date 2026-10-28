-- Engine probe for double-resolution overlays. Injects a synthetic actor
-- whose overlay grid is 2x its face box and checks the overlay's fill_rect
-- rows are half the base's pixel height.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end  -- troupe stub (the viewer installs resident art)
dofile(arg[1]) -- built viewer bundle: gives S.palette, compositor fns

S.sprites.test_hi = {
  face = { x = 0, y = 0, w = 2, h = 1 },
  base = "kk\nkk",
  expr = { neutral_closed = "rrrr\nrrrr", neutral_open = "rrrr\nrrrr" },
}
S.ACTOR_SCALE.test_hi = 6
S.init_sprites()

local heights = {}
screen.fill_rect = function(x, y, w, h) heights[#heights + 1] = h end
S.draw_character("test_hi", "neutral", false, 0, 0)
-- base rows draw at 6px; the 2x overlay's rows must draw at 3px.
local has6, has3, other = false, false, false
for _, h in ipairs(heights) do
  if h == 6 then has6 = true elseif h == 3 then has3 = true else other = true end
end
print("HIRES_OK " .. tostring(has6 and has3 and not other))
