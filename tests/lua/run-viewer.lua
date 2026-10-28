-- Smoke test: init + a few ticks + cycling buttons.
dofile("tests/lua/stubs.lua")
if arg[2] then dofile(arg[2]) end  -- troupe stub (the viewer installs resident art)
dofile(arg[1])
local ctx = { time_ms = 0 }
init(ctx)
for i = 1, 5 do
  ctx.time_ms = ctx.time_ms + 100
  on_tick(ctx, 100)
end
on_event(ctx, { name = "button", data = { index = 0 }, ts_ms = 0, from = "" })
on_event(ctx, { name = "button", data = { index = 1 }, ts_ms = 0, from = "" })
on_tick(ctx, 100)
print("FILL_RECTS " .. screen.fill_rects)
print("FLIPS " .. screen.flips)
