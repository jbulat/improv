-- run-art-error.lua <device app> [troupe stub] — loads the app with a wrong
-- or missing troupe module and proves it renders S.art_error and goes inert
-- (no crash on ticks or button events).
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end
dofile(arg[1])

local ctx = { time_ms = 0 }
init(ctx)
print("TEXTS " .. table.concat(screen.texts, "|"))
for _ = 1, 5 do
  ctx.time_ms = ctx.time_ms + 100
  on_tick(ctx, 100)
end
on_event(ctx, { name = "button", data = { index = 0 }, ts_ms = ctx.time_ms, from = "" })
on_event(ctx, { name = "button", data = { index = 1 }, ts_ms = ctx.time_ms, from = "" })
print("SURVIVED true")
