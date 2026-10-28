-- deep-compare-actor.lua <sim-emitted file> <chunk file> <actor id>
-- Prints EQUAL if the chunk expression evaluates to exactly the table the
-- sim emitter builds for that actor; DIFFERENT otherwise.
dofile("tests/lua/deep-eq.lua")

dofile(arg[1])                            -- populates S.sprites[arg[3]]
local chunk = assert(loadfile(arg[2]))()  -- the firmware chunk, evaluated

print(deep_eq(S.sprites[arg[3]], chunk) and "EQUAL" or "DIFFERENT")
