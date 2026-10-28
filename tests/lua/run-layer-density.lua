-- Engine probe for double-resolution layer art. Injects a synthetic
-- density-2 back_prop on a synthetic actor and checks two things the
-- byte-level tests cannot: that its rects draw at half the actor scale, and
-- that they land where layerAnchor() says they do.
--
-- The actor is synthetic so the geometry is arithmetic anyone can check by
-- hand rather than a property of whichever real actor happened to be picked.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end -- troupe stub (the viewer installs resident art)
dofile(arg[1]) -- built viewer bundle: gives S.palette, compositor fns

-- 4x4 base, ink filling rows 2-3 and columns 0-3: ink.top = 2, ink.left = 0,
-- ink.width = 4. Scale 6.
S.sprites.test_den = {
  face = { x = 0, y = 0, w = 2, h = 1 },
  base = "....\n....\nkkkk\nkkkk",
  expr = { neutral_closed = "..\n", neutral_open = "..\n" },
}
S.ACTOR_SCALE.test_den = 6
-- 8 layer-pixels wide at density 2 = 4 cells: an exact fit on a 4-cell ink
-- box, so it centers at ink.left with no slack. 2 rows at px=3 = 6 render px,
-- sitting directly on ink.top*6 = 12, so its top row is y = 6.
S.layer_art.back_prop = {
  hi = { dx = 0, dy = 0, density = 2, grid = "rrrrrrrr\nrrrrrrrr" },
  lo = { dx = 0, dy = 0, density = 1, grid = "rrrr\nrrrr" },
  -- Same 2x art as `hi`, nudged. dx/dy are in LAYER pixels, so each unit moves
  -- px (=3), not sc (=6) -- this fixture is the only thing in the suite that
  -- can tell those two apart. dy is negative on purpose: a positive dy would
  -- push the second row onto y=12 and cross the layer/base separator below.
  hi_nudged = { dx = 1, dy = -1, density = 2, grid = "rrrrrrrr\nrrrrrrrr" },
}
S.init_sprites()

local rects = {}
screen.fill_rect = function(x, y, w, h) rects[#rects + 1] = { x = x, y = y, w = w, h = h } end

local function draw(id)
  rects = {}
  S.draw_character("test_den", "neutral", false, 0, 0, { back_prop = id })
  local layer, base = {}, {}
  for _, r in ipairs(rects) do
    -- The base is `k`-inked at scale 6; the layer is the only thing drawn
    -- above ink.top*6 = 12, which separates them without reading colors.
    if r.y < 12 then layer[#layer + 1] = r else base[#base + 1] = r end
  end
  return layer
end

local hi = draw("hi")
print("HI_STEP " .. tostring(#hi > 0 and hi[1].h == 3))
print("HI_TOP " .. tostring(#hi > 0 and hi[1].y == 6))
print("HI_LEFT " .. tostring(#hi > 0 and hi[1].x == 0))

-- dx=1, dy=-1 at px=3: ox = 1*3 = 3, oy = 2*6 - 2*3 + (-1*3) = 3.
-- A `* sc` bug would give ox = 6, oy = 0 -- distinguishable on both axes.
local nudged = draw("hi_nudged")
print("NUDGE_X " .. tostring(#nudged > 0 and nudged[1].x == 3))
print("NUDGE_Y " .. tostring(#nudged > 0 and nudged[1].y == 3))

-- A density-1 layer of the same on-screen size must land identically: this is
-- the no-op property, checked in the engine rather than argued.
local lo = draw("lo")
print("LO_STEP " .. tostring(#lo > 0 and lo[1].h == 6))
print("LO_TOP " .. tostring(#lo > 0 and lo[1].y == 0))

-- Art with no declared density must behave exactly as density 1.
S.layer_art.back_prop.bare = { dx = 0, dy = 0, grid = "rrrr\nrrrr" }
S.init_sprites()
local bare = draw("bare")
print("BARE_DEFAULTS_TO_1 " .. tostring(#bare == #lo and bare[1].h == 6 and bare[1].y == lo[1].y))

-- Headwear is a second, independent copy of the same dx/dy*px formula
-- (compositor.lua's headwear block, not back_prop's) and nothing else in the
-- suite pins its coordinates -- run-headwear.lua only asserts a rect-count
-- delta. face = { x = 0, y = 0, w = 2, h = 1 }, sc = 6. Pick density 2 art
-- exactly as wide as face.w*d = 4 layer-px (no centering slack) so ox is
-- pure dx*px, and dx = 1, dy = 2 so both offsets are nonzero and the bug this
-- guards against (dx/dy multiplied by sc instead of px) is distinguishable
-- on both axes:
--   px = 6 // 2 = 3
--   ox = face.x*sc + ((face.w*d - art.w)//2)*px + dx*px = 0 + 0 + 1*3 = 3
--   oy = face.y*sc - art.h*px + dy*px = 0 - 2*3 + 2*3 = 0
-- (dy = 2 is also the smallest value that keeps the drawn rows at y >= 0 --
-- face.y = 0 means headwear anchors at or above the screen's top edge, and a
-- smaller dy would push rows to negative y where they'd still be emitted by
-- this stub but wouldn't correspond to anything the device actually shows.)
-- A `* sc` bug would give ox = 6, oy = 6 -- distinguishable on both axes.
S.layer_art.headwear = {
  hi_nudged = { dx = 1, dy = 2, density = 2, grid = "rrrr\nrrrr" },
}
S.init_sprites()

local function draw_headwear(id)
  rects = {}
  S.draw_character("test_den", "neutral", false, 0, 0, { headwear = id })
  local layer = {}
  for _, r in ipairs(rects) do
    if r.y < 12 then layer[#layer + 1] = r end
  end
  return layer
end

local hw = draw_headwear("hi_nudged")
print("HEADWEAR_X " .. tostring(#hw > 0 and hw[1].x == 3))
print("HEADWEAR_Y " .. tostring(#hw > 0 and hw[1].y == 0))
