# Improv StickS3

The Improv StickS3 is a wrist-sized ESP32-S3 playback terminal: M5Stack
StickS3, 8 MB flash, 8 MB PSRAM, a 1.14" 135×240 portrait TFT, two physical
buttons, and an I2S speaker. It has no on-device intelligence — it composites
pre-rendered sprite frames and plays pre-rendered WAV clips against a beat
timeline pushed from the cloud. Apps drive the screen as their primary output,
respond to button presses, and drive narration + sound effects through the
speaker.

## Hardware

**TFT screen:** ST7789, 135×240 pixels, portrait orientation (135 wide, 240
tall). The firmware auto-flips 180° via the IMU so the top of the screen is
always physically up (the device may stand on its USB end); both rotations
are 135×240, so apps never see dimensions change. Coordinates 0-based,
origin top-left. Colours 0–255 per channel.
Double-buffered: draw to an off-screen sprite, then `screen.flip()` to push
the frame.

**Buttons:** Two physical buttons, indexed 0 and 1 (GPIO 11/12). Surface as
`button` events carrying `data.index`. Press counts reset on app reset.

**Speaker:** One I2S speaker, driven two ways that share the same physical
output and the same master volume — set via `audio.set_volume()` only (the
buzzer has no volume control of its own):

- `audio.*` — WAV clip playback (narration lines, sound effects) read from
  the device filesystem, cached in PSRAM.
- `buzzer.*` — simple tone generation.

Two mixer channels are available for `audio.*` playback (0 and 1); `buzzer`
tones ride on top of whatever `audio` channels are playing.

## Lua Modules

### screen.*
**Hardware:** ST7789 TFT, 135×240 portrait, double-buffered.

```lua
-- Clear the off-screen sprite
screen.clear()                                   -- clear to black
screen.clear(255, 0, 0)                          -- clear to red

-- Draw text (defaults: size 2, white)
screen.text(10, 10, "HELLO")                     -- size 2, white
screen.text(10, 10, "HELLO", 3)                  -- size 3, white
screen.text(10, 10, "HELLO", 2, 255, 0, 0)       -- size 2, red

-- Shapes
screen.fill_rect(x, y, w, h, r, g, b)            -- filled rectangle
screen.rect(x, y, w, h, r, g, b)                 -- 1px outline rectangle
screen.line(x0, y0, x1, y1, r, g, b)             -- 1px line
screen.triangle(x0, y0, x1, y1, x2, y2, r, g, b) -- 1px outline triangle
screen.fill_triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.pixel(x, y, r, g, b)                      -- single pixel

-- Push the sprite to the display (call once per frame)
screen.flip()

-- Settings
screen.set_brightness(128)                       -- 0–255

-- Query dimensions
local w = screen.width()                         -- 135
local h = screen.height()                        -- 240
```

**MUST:** call `screen.flip()` after every draw sequence — nothing is
visible until you flip. On app reset the screen is cleared to black.

There is no `screen.qr` in this firmware. Its driver code is behind
`HAS_QRCODE`, and the build does not define it, so `screen.qr` is `nil`.

### button.*
**Hardware:** 2 physical buttons, indices 0 and 1.

```lua
local count = button.press_count()  -- total presses since the last app reset
```

Best practice: handle button presses in `on_event(ctx, e)` rather than
polling. The event has `name == "button"` and `data.index` (0 or 1).
The envelope also carries `from` (empty string for hardware events),
`ts_ms`, and `channel` (`"driver"` for hardware).

### buzzer.*
**Hardware:** I2S speaker driven as a simple tone generator.

```lua
buzzer.beep(440, 200)   -- frequency Hz, duration ms
buzzer.tone(1000)       -- start continuous tone
buzzer.stop()           -- stop the tone, and all other speaker sound
```

`buzzer.stop()` stops **every** speaker channel, not only the tone: it also
stops narration and sfx that `audio.play` started. Use `audio.stop(ch)` to stop
one clip. The simulator's `buzzer.stop()` stops only the tone, so it does not
show this.

Frequency is clamped to 20–20000 Hz; duration to 0–5000 ms. Tone is stopped
on app reset. `buzzer` and `audio` share the physical speaker — a tone and a
clip can sound simultaneously on different mixer channels.

### audio.*
**Hardware:** I2S speaker; each WAV clip is loaded whole into a ~6 MB PSRAM
cache and played from there.

Clips live on the device filesystem under `stories/<bundle>/`. Channels:
0 = narration, 1 = sfx; they mix on the speaker. Preload before playing —
`play()` loads (and caches) on demand if the clip isn't already cached, which
costs a blocking flash read on that call.

```lua
-- Clips live on the device filesystem under stories/<bundle>/.
-- Channels: 0 = narration, 1 = sfx; they mix. Preload before playing —
-- play() loads on demand (blocking flash read) if not already cached.
audio.preload("stories/my-story/aud_000.wav")        -- -> true/false

audio.play("stories/my-story/aud_000.wav", 0)        -- -> true/false
audio.play("stories/my-story/sfx_chime.wav", 1)

-- Optional third arg: start playback offset_ms into the clip. Used to
-- resume narration in sync with the beat clock after a pause — the beat
-- clock, not the clip, owns time.
audio.play("stories/my-story/aud_000.wav", 0, 3200)  -- rejoin 3.2s in

audio.stop(0)          -- stop one channel
audio.stop()           -- stop everything (no arg = every channel)

audio.is_playing(0)    -- -> boolean

audio.set_volume(200)  -- 0-255, THE master volume: one speaker, and the
                       -- buzzer has no volume API — this is the only knob
```

**Mix note:** the firmware pre-mixes the sfx channel (1) at 40% of full
volume so sound effects sit under the narration rather than covering it.
`audio.set_volume()` sets the shared master volume and preserves that
40% ratio — it is a device-side default, not something a Lua call needs to
manage.

**Constraints:** 16-bit mono PCM WAV only (any sample rate — the driver
reads it as-is, no transcoding). Clips are cached in a ~6 MB PSRAM pool,
freed on app reset. A missing or malformed file makes `preload`/`play`
return `false` and log a warning on serial — they never crash the app.

### troupe.*
**Hardware:** resident sprite art baked into firmware flash
(`device/lib/drivers/src/TroupeArtData.h`).

```lua
troupe.install(S, { "ada", "bruno" })  -- populates S.palette / S.sprites for these actor ids
troupe.fingerprint()                   -- -> hex string identifying the resident art set
```

This exists for the generated story-app prelude (`tools/build-app.ts`), which
compares `troupe.fingerprint()` against the value it was built against and calls
`troupe.install()` before running. It is not a general app-authoring surface — hand-written apps
have no reason to call it.

## Examples

**Hello world:**

```lua
function init(ctx)
  screen.clear()
  screen.text(10, 10, "HELLO WORLD")
  screen.flip()
end
```

**Two-button counter with beep:**

```lua
local count = 0

function init(ctx)
  draw()
end

function draw()
  screen.clear()
  screen.text(10, 10, "Count: " .. count)
  screen.text(10, 50, "Btn0: +1")
  screen.text(10, 70, "Btn1: reset")
  screen.flip()
end

function on_event(ctx, e)
  if e.name == "button" then
    if e.data.index == 0 then
      count = count + 1
      buzzer.beep(440, 50)
    else
      count = 0
      buzzer.beep(880, 50)
    end
    draw()
  end
end
```

**Play-on-press audio (the `audio-check.lua` core):**

```lua
local ROOT = "stories/knight-and-lonely-dragon"

function init(ctx)
  audio.preload(ROOT .. "/aud_001.wav")
  audio.preload(ROOT .. "/sfx_chime.wav")
end

function on_tick(ctx, dt_ms)
  screen.clear(26, 28, 44)
  screen.text(4, 8, "AUDIO CHECK", 2, 255, 205, 117)
  screen.text(4, 60, "line ch0: " .. tostring(audio.is_playing(0)), 1, 148, 176, 194)
  screen.text(4, 74, "sfx  ch1: " .. tostring(audio.is_playing(1)), 1, 148, 176, 194)
  screen.flip()
end

function on_event(ctx, e)
  if e.name ~= "button" then return end
  if e.data.index == 0 then
    audio.play(ROOT .. "/aud_001.wav", 0)   -- narration
  else
    audio.play(ROOT .. "/sfx_chime.wav", 1) -- sfx, mixes under it
  end
end
```

## Constraints

- Screen: 135×240 portrait, 0-based coords, 0–255 colour channels. IMU
  auto-flip is transparent to apps.
- Buzzer: frequency clamped 20–20000 Hz; duration clamped 0–5000 ms.
- Two buttons only — indices 0 and 1.
- Audio: 16-bit mono PCM WAV only; ~6 MB PSRAM clip cache, freed on app
  reset; two mix channels (0 narration, 1 sfx); sfx pre-mixed at 40%.

## Practical Tips

- The screen is the primary output surface.
- Display orientation is portrait (135 wide × 240 tall). Authors who
  forget this draw wide apps that look wrong.
- Always call `screen.flip()` after a draw sequence — double-buffered.
- Use `e.data.index` (0 or 1) to distinguish buttons in `on_event`.
- Use an ASCII-only font — non-ASCII glyphs aren't guaranteed to render.
- Preload every clip you'll need in `init()`; playing an unpreloaded clip
  still works but pays a blocking flash read on that call, which can cause
  an audible stutter.
- Stop channel 0 before starting a new narration line (`audio.stop(0)`
  then `audio.play(...)`) rather than relying on `play()`'s implicit
  `stop_current_sound` — makes the intent explicit at call sites.

## Validation stubs

Optional Lua block consumed by `validate-app` to provide concrete return
values for getter-style functions. Without these, getter calls return
`nil` and apps that do arithmetic on the result crash inside the
validator.

```lua
screen = setmetatable({
  width  = function() return 135 end,
  height = function() return 240 end,
}, { __index = function() return function() end end })

button = setmetatable({
  press_count = function() return 0 end,
}, { __index = function() return function() end end })

buzzer = setmetatable({}, { __index = function() return function() end end })

audio = setmetatable({
  preload    = function() return true end,
  play       = function() return true end,
  is_playing = function() return false end,
}, { __index = function() return function() end end })
```

For a running check rather than a static one, `npm run sim -- --bundle <dir>` executes the app
against this same surface with a real screen, real audio and real buttons; `--headless` does it
without a browser.

## App mode / Shader mode

In app mode this device uses the normal app lifecycle (`init`, `on_tick`,
`on_event`) against the `screen`, `button`, `buzzer`, and `audio` modules
described above.

Shader mode is not available on this device — only app mode is supported.
