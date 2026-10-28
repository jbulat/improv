-- front_prop probe: draws rosa bare and with a synthetic held blade
-- ("testblade") gripped at an injected hand anchor placed mid-torso, so the
-- blade crosses her inked body. front_prop draws LAST, so the property under
-- test is the opposite of run-back-prop's: where blade and body overlap, the
-- BLADE must win. Pixel colors at screen coordinates, not rect counts — a
-- count delta would also pass if the blade drew underneath.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end -- troupe stub (the viewer installs resident art)
dofile(arg[1]) -- a built viewer bundle: S.sprites = every actor with art

local pixels = {}
local function key(x, y) return y * 100000 + x end
local real_fill_rect = screen.fill_rect
screen.fill_rect = function(x, y, w, h, r, g, b)
  real_fill_rect(x, y, w, h, r, g, b)
  for py = y, y + h - 1 do
    for px = x, x + w - 1 do
      pixels[key(px, py)] = r .. "," .. g .. "," .. b
    end
  end
end

S.init_sprites()
local sc = S.actor_scale("rosa")

-- 2-wide, 8-tall cyan blade; synthetic hand at (16, 20), an inked torso pixel,
-- so rows 13-20 of the blade all lie on rosa's body.
local w, h = 2, 8
S.layer_art.front_prop = {
  testblade = { grid = string.rep(string.rep("c", w) .. "\n", h), dx = 0, dy = 0 },
}
S.hand = { rosa = { x = 16, y = 20 } }
S.init_sprites() -- re-decode with the injected art
local a = S.runs.rosa

pixels = {}
S.place_character("rosa", "neutral", false)
local bare = pixels

pixels = {}
S.place_character("rosa", "neutral", false, { front_prop = "testblade" })
local frame = pixels

-- Screen coordinates of the blade's top-left pixel, mirroring the compositor's
-- front_prop anchor (d = 1, px = sc; dx/dy = 0):
--   ox = x0 + hand.x*sc + ((1 - w)//2)*sc = x0 + 15*sc
--   oy = y0 + (hand.y + 1)*sc - h*sc     = y0 + 13*sc
local x0 = math.floor((S.SCREEN_W - a.width * sc) / 2) - a.left * sc
local y0 = S.BASELINE_Y - a.bottom * sc
local ox = x0 + 16 * sc + ((1 - w) // 2) * sc
local oy = y0 + (20 + 1) * sc - h * sc

-- (ox, oy) is base-grid (15, 13), an inked pixel of rosa's arm: the bare draw
-- painted it, and the blade must have REPAINTED it — topmost means the blade
-- wins exactly where back_prop loses.
print("UNDER_BODY_WHEN_BARE " .. tostring(bare[key(ox, oy)] ~= nil))
print("BLADE_WINS " .. tostring(frame[key(ox, oy)] == "115,239,247"))

-- Forgiving degradation: an unknown id, and a worn front_prop with no S.hand
-- entry for the wearer, must both draw exactly the bare sprite.
screen.fill_rects = 0
S.place_character("rosa", "neutral", false)
local bare_rects = screen.fill_rects
screen.fill_rects = 0
S.place_character("rosa", "neutral", false, { front_prop = "excalibur_no_art" })
local unknown_rects = screen.fill_rects
S.hand = nil
screen.fill_rects = 0
S.place_character("rosa", "neutral", false, { front_prop = "testblade" })
local no_hand_rects = screen.fill_rects
print("FORGIVING " .. tostring(unknown_rects == bare_rects and no_hand_rects == bare_rects))
