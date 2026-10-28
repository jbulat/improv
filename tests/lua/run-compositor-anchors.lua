-- Anchor probe: after S.init_sprites(), print every actor's computed ink
-- `top` (the topmost inked row of the base grid) so the TS side can check it
-- against tools/lib/placement.ts's inkBox().top. tostring() so a nil top
-- prints as "nil" instead of erroring the concatenation.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end  -- troupe stub (the viewer installs resident art)
dofile(arg[1]) -- a built viewer bundle: S.sprites = every actor with art
S.init_sprites()
local ids = {}
for id in pairs(S.sprites) do ids[#ids + 1] = id end
table.sort(ids)
for _, id in ipairs(ids) do
  print("TOP " .. id .. " " .. tostring(S.runs[id].top))
end
