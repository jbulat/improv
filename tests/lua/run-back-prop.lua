-- back_prop probe: draws rosa bare and with a synthetic back_prop
-- ("testblock") that straddles her ink box, then diffs a painted-pixel map to
-- check draw order. The property that matters is that the base occludes the
-- prop, not merely that "something extra" got drawn: a naive rect-count delta
-- would also pass if the prop drew on TOP of the base, so this checks actual
-- pixel colors at actual screen coordinates.
--
-- testblock is wider than rosa's ink box and anchored (dy = its own height)
-- so its top row lands exactly on her ink top -- overlapping her body
-- vertically while also overstepping the ink box on both sides
-- horizontally. That gives two disjoint pixels to check: one inside the
-- silhouette (must come out identical to the bare render -- the base wins)
-- and one outside it (must appear only in the prop's render -- proves the
-- prop actually drew, rather than never drawing at all).
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end -- troupe stub (the viewer installs resident art)
dofile(arg[1]) -- a built viewer bundle: S.sprites = every actor with art

-- Paint into a sparse pixel map alongside the recording stub, so draw order
-- can be checked pixel-by-pixel, not just by rect count.
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
local a = S.runs.rosa
local sc = S.actor_scale("rosa")

-- w wider than rosa's ink width; h/dy chosen so the block's top row lands
-- exactly on a.top (dy = h cancels -h in the anchor formula).
local w, h = a.width + 10, 6
S.layer_art.back_prop = {
  testblock = { grid = string.rep(string.rep("c", w) .. "\n", h), dx = 0, dy = h },
}
S.init_sprites() -- re-decode: now with the injected back_prop art
a = S.runs.rosa   -- init_sprites rebuilds S.runs; re-fetch

pixels = {}
S.place_character("rosa", "neutral", false)
local bare = pixels

pixels = {}
S.place_character("rosa", "neutral", false, { back_prop = "testblock" })
local frame = pixels

-- Every pixel the bare render inked must come out identical with the prop
-- drawn behind it -- the base must fully overdraw the prop where they
-- overlap.
local mismatches = 0
for k, v in pairs(bare) do
  if frame[k] ~= v then mismatches = mismatches + 1 end
end
print("OCCLUSION_MISMATCHES " .. mismatches)

-- Screen coordinates of the block's top-left pixel, computed the same way
-- S.place_character and the compositor's back_prop anchor do (dx=0 so the
-- x term drops; dy=h so the y term reduces to a.top*sc).
local x0 = math.floor((S.SCREEN_W - a.width * sc) / 2) - a.left * sc
local y0 = S.BASELINE_Y - a.bottom * sc
-- Mirrors the compositor's back_prop anchor in render pixels. testblock
-- declares no density, so d = 1 and px = sc, and the render-pixel anchor
-- reduces to the cell-coordinate one.
local d, px = 1, sc
local outside_x = x0 + a.left * sc + ((a.width * d - w) // 2) * px
local outside_y = y0 + a.top * sc
print("OUTSIDE_ABSENT_WHEN_BARE " .. tostring(bare[key(outside_x, outside_y)] == nil))
print("OUTSIDE_DRAWN " .. tostring(frame[key(outside_x, outside_y)] ~= nil))
