-- deep-compare-install.lua <sim-emitted file> <stub file> <actor id...>
-- Installs the listed actors through the troupe stub into a fresh table and
-- deep-compares palette + every actor against the sim emitter's S.
dofile("tests/lua/deep-eq.lua")  -- defines global deep_eq(a, b)

dofile(arg[2])   -- defines global troupe (the stub)
local T = {}
local ids = {}
for i = 3, #arg do ids[#ids + 1] = arg[i] end
troupe.install(T, ids)
dofile(arg[1])   -- defines global S via the sim emitter

local ok = deep_eq(T.palette, S.palette)
for i = 1, #ids do
  ok = ok and deep_eq(T.sprites[ids[i]], S.sprites[ids[i]])
end
print(ok and "EQUAL" or "DIFFERENT")
