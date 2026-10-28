-- compositor: decode sprite row-strings into run lists once, then draw
-- characters as scaled fill_rect runs, back to front. Of the paper-doll
-- slots, headwear, back_prop and front_prop are drawn; costume is not.

-- Per-actor render scale (portrait 135x240): 6x for each listed actor except
-- miss_moon, who stays at 4x so The End keeps its gap below her. Unlisted
-- actors fall back to 4x. Mirrored by tools/preview-layout.ts; keep the two
-- in sync.
S.ACTOR_SCALE = { ada = 6, bruno = 6, milo = 6, rosa = 6, pip = 6, tuk = 6, miss_moon = 4 }
S.SCALE_DEFAULT = 4
S.SCREEN_W = 135
S.BASELINE_Y = 236  -- grounded actors: lowest inked row lands here
S.MOON_Y = 8        -- miss_moon: sprite top -- she hangs in the sky

function S.actor_scale(actor)
  return S.ACTOR_SCALE[actor] or S.SCALE_DEFAULT
end
S.runs = {}

local function rows_of(str)
  local rows = {}
  for line in string.gmatch(str, "[^\n]+") do
    rows[#rows + 1] = line
  end
  return rows
end

local function runs_of(rows)
  local runs = {}
  for y = 1, #rows do
    local row = rows[y]
    local x = 1
    while x <= #row do
      local c = string.sub(row, x, x)
      local x2 = x
      while x2 < #row and string.sub(row, x2 + 1, x2 + 1) == c do
        x2 = x2 + 1
      end
      if c ~= "." then
        runs[#runs + 1] = { x - 1, y - 1, x2 - x + 1, c }
      end
      x = x2 + 1
    end
  end
  return runs
end

function S.init_sprites()
  -- Layer art (S.layer_art, emitted per bundle) decodes to runs the same way
  -- actor art does; slots the bundle doesn't use are simply absent.
  S.layer_runs = {}
  for slot, items in pairs(S.layer_art or {}) do
    S.layer_runs[slot] = {}
    for id, item in pairs(items) do
      local grid = rows_of(item.grid)
      S.layer_runs[slot][id] = {
        runs = runs_of(grid), w = #grid[1], h = #grid, dx = item.dx, dy = item.dy,
        -- Declared per item, not detected: a layer grid has no reference frame
        -- to compare against the way an expression overlay has its face box.
        -- Absent means 1, which is what art injected by tests relies on.
        density = item.density or 1,
      }
    end
  end
  for id, spr in pairs(S.sprites) do
    local base = runs_of(rows_of(spr.base))
    -- Ink extents of the base grid: lowest row for grounding, column span
    -- for centering, topmost row for back_prop -- at 5-6x the 32px grid
    -- overflows the 135px screen even when the figure fits, so placement
    -- must use the ink box.
    local bottom, left, right, top = 0, 32, 0, 32
    for i = 1, #base do
      local r = base[i]
      if r[2] + 1 > bottom then bottom = r[2] + 1 end
      if r[2] < top then top = r[2] end
      if r[1] < left then left = r[1] end
      if r[1] + r[3] > right then right = r[1] + r[3] end
    end
    local entry = {
      base = base, bottom = bottom, left = left, top = top, width = right - left,
      face = spr.face, expr = {}, expr_div = {},
    }
    for name, str in pairs(spr.expr) do
      local grid = rows_of(str)
      entry.expr[name] = runs_of(grid)
      -- Double-resolution overlays (grid is 2x the face box) draw at half
      -- the actor scale; detected per overlay so lo-res and hi-res faces
      -- can coexist.
      entry.expr_div[name] = (#grid == spr.face.h * 2) and 2 or 1
    end
    S.runs[id] = entry
  end
end

local function draw_runs(runs, ox, oy, sc)
  for i = 1, #runs do
    local r = runs[i]
    local col = S.palette[r[4]]
    screen.fill_rect(ox + r[1] * sc, oy + r[2] * sc, r[3] * sc, sc, col[1], col[2], col[3])
  end
end

function S.has_expr(actor, expression)
  local a = S.runs[actor]
  return a ~= nil and a.expr[expression .. "_closed"] ~= nil
end

function S.wrap(text, max)
  local lines, cur = {}, ""
  for word in string.gmatch(text, "%S+") do
    if #cur == 0 then
      cur = word
    elseif #cur + 1 + #word <= max then
      cur = cur .. " " .. word
    else
      lines[#lines + 1] = cur
      cur = word
    end
  end
  if #cur > 0 then lines[#lines + 1] = cur end
  return lines
end

-- Resident-art failure (S.art_error, set by the device prelude): render the
-- message and go inert, rather than crash in init_sprites or draw garbage from
-- a mismatched art set. Shared here because every device entry (main.lua,
-- viewer.lua) guards on S.art_error and calls this.
-- Size 2, because size 1 is too small to read on the 135x240 screen. Size 2
-- fits 11 chars per line, so each line is re-wrapped, and a line cap keeps a
-- long Lua error from running off the bottom; the full text is on serial.
function S.draw_art_error()
  screen.clear(26, 28, 44)
  local y = 24
  local function emit(line)
    if y > 208 then return false end
    screen.text(4, y, line, 2, 239, 125, 87)
    y = y + 18
    return true
  end
  for raw in string.gmatch(S.art_error, "[^\n]+") do
    for _, wrapped in ipairs(S.wrap(raw, 11)) do
      -- S.wrap breaks on spaces only, so a single long token -- a chunk name
      -- or path inside an interpolated Lua error -- survives it intact and
      -- would run off the right edge. Hard-split those.
      local line = wrapped
      while #line > 11 do
        if not emit(string.sub(line, 1, 11)) then
          screen.flip()
          return
        end
        line = string.sub(line, 12)
      end
      if not emit(line) then
        screen.flip()
        return
      end
    end
  end
  screen.flip()
end

-- Layer order per improv-design.md: back_prop, base, costume,
-- expression, headwear, front_prop. Everything but costume is drawn.
-- `layers` is the role's slot->id table (from the cast), or nil for none.
function S.draw_character(actor, expression, mouth_open, x, y, layers)
  local a = S.runs[actor]
  if not a then return end
  local sc = S.actor_scale(actor)
  -- back_prop draws first, so the body occludes it: only what falls outside
  -- the silhouette shows. Registers on the base ink box (centered on the ink
  -- columns, bottom row above the topmost inked row), shifted by (dx, dy).
  -- Mirrors layerAnchor() in tools/lib/sprites.ts; keep the two in sync.
  -- Coordinates are render pixels: `px` is one grid cell, half the actor
  -- scale for 2x art, and dx/dy are in grid cells so they scale with it.
  -- The `* d` inside the centering floor quantizes to the layer's own pixel.
  local bp = layers and layers.back_prop
  local bpi = bp and S.layer_runs.back_prop and S.layer_runs.back_prop[bp]
  if bpi then
    local d = bpi.density
    local px = sc // d
    local ox = x + a.left * sc + ((a.width * d - bpi.w) // 2) * px + bpi.dx * px
    local oy = y + a.top * sc - bpi.h * px + bpi.dy * px
    draw_runs(bpi.runs, ox, oy, px)
  end
  draw_runs(a.base, x, y, sc)
  local key = expression .. (mouth_open and "_open" or "_closed")
  if not a.expr[key] then key = expression .. "_closed" end
  local e = a.expr[key]
  if e then
    -- Hi-res overlays require an even actor scale (all troupe scales are).
    draw_runs(e, x + a.face.x * sc, y + a.face.y * sc, sc // a.expr_div[key])
  end
  -- Headwear anchors on the face box: centered horizontally, bottom row on
  -- the row above the face top, shifted by the art's (dx, dy). The runtime
  -- is forgiving: an id with no baked art just doesn't draw.
  local hw = layers and layers.headwear
  local item = hw and S.layer_runs.headwear and S.layer_runs.headwear[hw]
  if item then
    local d = item.density
    local px = sc // d
    local ox = x + a.face.x * sc + ((a.face.w * d - item.w) // 2) * px + item.dx * px
    local oy = y + a.face.y * sc - item.h * px + item.dy * px
    draw_runs(item.runs, ox, oy, px)
  end
  -- front_prop draws last: a held item passes in front of everything. It
  -- registers on the wearer's hand anchor (S.hand, emitted per bundle so the
  -- firmware fingerprint never moves), centred over the hand pixel with its
  -- bottom row on the hand row, so the hand covers the grip. Mirrors
  -- layerAnchor() in tools/lib/sprites.ts; keep the two in sync. No art, or
  -- no hand for this actor, draws nothing.
  local fp = layers and layers.front_prop
  local fpi = fp and S.layer_runs.front_prop and S.layer_runs.front_prop[fp]
  local hand = S.hand and S.hand[actor]
  if fpi and hand then
    local d = fpi.density
    local px = sc // d
    local ox = x + hand.x * sc + ((d - fpi.w) // 2) * px + fpi.dx * px
    local oy = y + (hand.y + 1) * sc - fpi.h * px + fpi.dy * px
    draw_runs(fpi.runs, ox, oy, px)
  end
end

-- Draw so the sprite's lowest inked row sits exactly on baseline_y.
function S.draw_grounded(actor, expression, mouth_open, x, baseline_y, layers)
  local a = S.runs[actor]
  if not a then return end
  S.draw_character(actor, expression, mouth_open, x, baseline_y - a.bottom * S.actor_scale(actor), layers)
end

-- Layout policy for every screen: actors stand grounded on the shared
-- baseline; miss_moon, a moon in the sky, hangs from MOON_Y instead.
-- Horizontal placement centers the ink box.
function S.place_character(actor, expression, mouth_open, layers)
  local a = S.runs[actor]
  if not a then return end
  local sc = S.actor_scale(actor)
  local x = math.floor((S.SCREEN_W - a.width * sc) / 2) - a.left * sc
  if actor == "miss_moon" then
    S.draw_character(actor, expression, mouth_open, x, S.MOON_Y, layers)
  else
    S.draw_grounded(actor, expression, mouth_open, x, S.BASELINE_Y, layers)
  end
end
