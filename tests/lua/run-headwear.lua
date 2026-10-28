-- Headwear probe: drawing tuk with the dragon's horns must add fill_rect runs
-- above the bare draw, without changing the grounded footprint (horns rise
-- from the head; feet stay on the baseline).
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end -- troupe stub (device apps install resident art)
dofile(arg[1]) -- a built player bundle whose cast bakes headwear (the knight story)
S.init_sprites()

screen.fill_rects = 0
screen.max_fill_bottom = 0
S.place_character("tuk", "neutral", false)
local bare_rects = screen.fill_rects
local bare_bottom = screen.max_fill_bottom

screen.fill_rects = 0
screen.max_fill_bottom = 0
S.place_character("tuk", "neutral", false, { headwear = "horns" })
print("HEADWEAR_DELTA " .. (screen.fill_rects - bare_rects))
print("BOTTOM_UNCHANGED " .. tostring(screen.max_fill_bottom == bare_bottom))

-- Unknown ids and empty layer tables must draw exactly the bare sprite.
screen.fill_rects = 0
S.place_character("tuk", "neutral", false, { headwear = "propeller_beanie" })
local unknown_rects = screen.fill_rects
screen.fill_rects = 0
S.place_character("tuk", "neutral", false, {})
local empty_rects = screen.fill_rects
print("FORGIVING " .. tostring(unknown_rects == bare_rects and empty_rects == bare_rects))
