# Workflows

Every tool, with its commands and flags. To install and play your first story, start with
[`GETTING-STARTED.md`](GETTING-STARTED.md).

- [Preview a character's art](#preview-a-characters-art)
- [Hear a story on the computer](#hear-a-story-on-the-computer)
- [Generate a new story](#generate-a-new-story)
- [Export a story for review](#export-a-story-for-review)
- [The validator's rules](#the-validators-rules)
- [Exporting a story as video](#exporting-a-story-as-video)
- [The README's demo video](#the-readmes-demo-video)
- [The examples' videos](#the-examples-videos)
- [The social preview card](#the-social-preview-card)
- [Playing it in the simulator](#playing-it-in-the-simulator)
- [Reviewing the art](#reviewing-the-art)
- [Changing an actor's art](#changing-an-actors-art)
- [Setting up the device](#setting-up-the-device)
- [Playing it on the device](#playing-it-on-the-device)
- [Known limits of delivery](#known-limits-of-delivery)

The first four are the things you'll most often want to do, each headless (no device, no browser).

## Preview a character's art

Render an actor's base plus every expression overlay to a PNG contact sheet, composited exactly the way the device does, so you can review sprite art without flashing anything.

```sh
npm run preview:art -- milo                 # -> .art-preview/milo.png
npm run preview:art -- miss_moon --out /tmp/moon.png
npm run preview:art -- tuk --layer headwear:horns    # review a layer on its wearer
npm run preview:art -- rosa --layer back_prop:wings  # back props draw behind the actor
```

Actor ids: `bruno`, `milo`, `ada`, `rosa`, `pip`, `tuk`, and the host `miss_moon`. Output goes to `.art-preview/<actor>.png` by default (gitignored, regenerable). `--layer <slot>:<id>` composites a layer from `sprites/layers/<slot>/` onto every cell, using the same anchor math and draw order as the device: a `back_prop` renders behind the actor, so the body occludes it. (`--headwear <id>` still works as a shorthand for `--layer headwear:<id>`.) Note the sheet draws the 32x32 authoring **cell**, which is not the screen: at 6x a full cell is 192px wide against a 135px display, so art can look fine here and still be clipped on device. `build:app` is what enforces the screen bound.

## Hear a story on the computer

Mix a bundle's whole timeline (every spoken line plus every sound effect, each placed at its real beat offset) into a single WAV. Building it is deterministic and cross-platform (it reads the rendered clips already in the bundle; no OS audio needed). `--play` is a best-effort convenience that shells out to whatever player is on `PATH` (`afplay`/`paplay`/`aplay`/`ffplay`).

```sh
npm run preview:audio -- --bundle fixtures/knight-and-lonely-dragon
# -> .audio-preview/knight-and-lonely-dragon.wav  (~40s, 16 kHz mono)

npm run preview:audio -- --bundle fixtures/knight-and-lonely-dragon --play
npm run preview:audio -- --bundle fixtures/a-dog-called-bear --out /tmp/story.wav
```

The line clips and the sfx are committed. `npm run gen:audio -- --bundle <dir>` re-renders the lines, and `npm run gen:sfx -- --bundle <dir>` the sfx.

**This is a convenience mix, not the device's mix.** Lines and sound effects are summed at equal gain into one mono track, and clips are placed at scheduled beat starts. The device plays two channels with sfx pre-mixed at **40%**, driven by the beat-walker's real clock, so cues here sit far louder against the narration than they ever will in the performance. Use it to hear a story on a machine with no browser, or to hand someone a file; use `npm run sim` to judge one.

## Generate a new story

The AI Author → Director pipeline was designed as cloud work and never built. In this prototype a story is one bundle directory under `fixtures/`, written by a Claude Code skill or by hand:

In a Claude Code session, the `story-create` skill drives this whole workflow interactively. The child supplies the idea, and the skill asks between one and three questions to draw it out (always at least one, a "yes, and" when the idea needs no filling in), co-writes the rest, runs the build steps below, sanity-checks the result with a headless play-through, and gets the story playing in the local sim (or on the device with `--device`). It shows the measured beat table afterwards, as a record rather than a gate: the clock that matters is the seconds between a child telling their story and seeing it. `story-create-debug` is the same work with the full creation-time test pass (beat-table approval before building, `npm test`, and dual sign-off) for developing and debugging the pipeline rather than making a story with a child. In this prototype the two skills *are* the Author and Direct stages.

1. **Write `performance.json`.** Cast each role onto an actor + voice, then write the beat timeline (`character_id`, `expression`, `text`, `sfx`). Follow `schema/performance.schema.json` and the casting rules in [`improv-troupe.md`](improv-troupe.md); the existing bundles are the templates. Optionally add `spoken-overrides.json` (audio id → the text TTS should speak, when it differs from the on-screen text).
2. **Render sfx.** `npm run gen:sfx -- --bundle <dir>` (deterministic chiptune; it writes the sounds the bundle's manifest lists).
3. **Render line audio + measure durations.** `npm run gen:audio -- --bundle <dir> --write-durations`. This renders one WAV per line and patches the measured clip durations back into `performance.json`, so beat pacing is real. (Kokoro, installed once with `npm run setup:kokoro`; a cloud TTS would slot in here unchanged.) Durations are the only thing it patches: if a re-render changes a clip's length on a beat that carries `sfx` cues, it warns and lists those cues, because their `at_ms` offsets were written against the old clip and are not rescaled. Re-check them by ear.
4. **Validate.** `npm run validate -- <dir>/performance.json --check-files`. Every reference must resolve and every asset file must exist.
5. **Build the device bundle.** `npm run build:app -- --bundle <dir>` → `device-apps/improv/build/<name>.device.lua`. This is the app hardware runs and the app the local simulator runs; it is the only one committed.

Then review it: [export the table](#export-a-story-for-review) and [hear it](#hear-a-story-on-the-computer).

## Export a story for review

Dump a bundle's timeline as a flat, one-row-per-beat table for human review or debugging. Columns: **beat**, **seconds**, **actor**, **role**, **text**, **expression**, **sfx**, **layers**. Markdown by default (drops straight into a PR or issue); `--csv` for spreadsheets.

```sh
npm run export:story -- --bundle fixtures/knight-and-lonely-dragon          # Markdown table
npm run export:story -- --bundle fixtures/knight-and-lonely-dragon --csv    # CSV
```

`actor` is the fixed troupe body (`milo`, `tuk`, …); `role` is the character in this story (the cast display name, e.g. "the dragon"); `sfx` lists each cue as `id@offset` (e.g. `sfx_whoosh@0.4s`).

## The validator's rules

The validator, [`tools/lib/validator.ts`](tools/lib/validator.ts), is plain code with no model
inside, so the same story always gets the same result. Each failure prints the rule's name, the
path to the field, and the reason:

    ERROR   [ACTOR_DOUBLED] /cast/2/actor — actor "milo" already plays "hero" — one role per actor

Run it with `npm run validate -- <dir>/performance.json`. `build:app` runs it too, with
`--check-files`, and refuses a story with any error. Warnings are printed, and do not stop the
build.

There are 25 rules: 23 errors and 2 warnings. Each broken example in
[`fixtures/invalid/`](fixtures/invalid/) is a story built to break one rule, and `npm test` checks
that it still does. `npm run gen:invalid` regenerates them.

| Rule | Level | What it checks | Broken example |
|---|---|---|---|
| `SHAPE` | error | The file matches the JSON Schema, [`schema/performance.schema.json`](schema/performance.schema.json). | [`bad-shape-missing-cast`](fixtures/invalid/bad-shape-missing-cast.json) |
| `MISS_MOON_MISSING` | error | Miss Moon is cast as the host. | [`bad-missing-miss-moon`](fixtures/invalid/bad-missing-miss-moon.json) |
| `MISS_MOON_MISCAST` | error | Miss Moon plays no story role, and only she plays the host. | [`bad-moon-cast-in-role`](fixtures/invalid/bad-moon-cast-in-role.json) |
| `UNKNOWN_ACTOR` | error | Every cast actor is in the troupe. | [`bad-unknown-actor`](fixtures/invalid/bad-unknown-actor.json) |
| `DUPLICATE_CHARACTER` | error | No two roles share a character id. | [`bad-duplicate-character`](fixtures/invalid/bad-duplicate-character.json) |
| `ACTOR_DOUBLED` | error | No actor plays two roles. | [`bad-actor-doubled`](fixtures/invalid/bad-actor-doubled.json) |
| `VOICE_NOT_SIGNATURE` | error | Each role speaks in its actor's own voice. | [`bad-voice-not-actor-signature`](fixtures/invalid/bad-voice-not-actor-signature.json) |
| `BAD_EXPRESSION` | error | Every expression, a role's default and each beat's, belongs to that actor. | [`bad-expression-for-actor`](fixtures/invalid/bad-expression-for-actor.json) |
| `UNKNOWN_LAYER` | error | Every layer is in the troupe's catalogue for its slot. | [`bad-unknown-layer`](fixtures/invalid/bad-unknown-layer.json) |
| `LAYER_MISFIT` | error | Every layer fits the actor wearing it, in the cast and in each beat. | [`bad-layer-misfit`](fixtures/invalid/bad-layer-misfit.json), [`bad-beat-layer-misfit`](fixtures/invalid/bad-beat-layer-misfit.json), [`bad-back-prop-misfit`](fixtures/invalid/bad-back-prop-misfit.json) |
| `UNKNOWN_CHARACTER` | error | Every beat's character is in the cast. | [`bad-unknown-character`](fixtures/invalid/bad-unknown-character.json) |
| `BAD_INDEX` | error | Beats are numbered 0, 1, 2 and so on, with no gaps. | [`bad-noncontiguous-index`](fixtures/invalid/bad-noncontiguous-index.json) |
| `SPEAK_WITHOUT_AUDIO` | error | A speaking beat has a line clip. | [`bad-speak-without-audio`](fixtures/invalid/bad-speak-without-audio.json) |
| `BAD_AUDIO_REF` | error | Every line and sound effect a beat uses is in the audio list. | [`bad-audio-ref`](fixtures/invalid/bad-audio-ref.json) |
| `BAD_AUDIO_KIND` | error | A beat's line is a line clip, and its sound effects are sound-effect clips. | [`bad-audio-kind`](fixtures/invalid/bad-audio-kind.json) |
| `DUPLICATE_AUDIO_ID` | error | No two audio clips share an id. | [`bad-duplicate-audio-id`](fixtures/invalid/bad-duplicate-audio-id.json) |
| `AUDIO_URI_OUTSIDE_BUNDLE` | error | Every audio path stays inside the story's folder. | [`bad-audio-uri-outside-bundle`](fixtures/invalid/bad-audio-uri-outside-bundle.json) |
| `SFX_NOT_IN_VOCABULARY` | error | Every sound effect is in the troupe's shared list. | [`bad-sfx-not-in-vocabulary`](fixtures/invalid/bad-sfx-not-in-vocabulary.json) |
| `SFX_OUT_OF_ORDER` | error | A beat's sound-effect cues are in time order. | [`bad-sfx-out-of-order`](fixtures/invalid/bad-sfx-out-of-order.json) |
| `SFX_PAST_END` | error | No sound-effect cue starts after its beat ends. | [`bad-sfx-past-end`](fixtures/invalid/bad-sfx-past-end.json) |
| `UNKNOWN_DEVICE` | error | Every device a beat or the stage names is in the stage's device list. | [`bad-unknown-device`](fixtures/invalid/bad-unknown-device.json) |
| `AUDIO_FILE_MISSING` | error | Every audio file exists. Checked with `--check-files`. | Tested in [`tests/validator.test.ts`](tests/validator.test.ts) |
| `AUDIO_DURATION_MISMATCH` | error | Each audio file's length matches the length the file lists. Checked with `--check-files`. | Tested in [`tests/validator.test.ts`](tests/validator.test.ts) |
| `DURATION_SHORT` | warning | A speaking beat lasts at least as long as its line clip. | Tested in [`tests/validator.test.ts`](tests/validator.test.ts) |
| `ORPHAN_AUDIO` | warning | Every audio clip is used by some beat. | Tested in [`tests/validator.test.ts`](tests/validator.test.ts) |

## Exporting a story as video

```sh
npm run export:video -- --bundle fixtures/knight-and-lonely-dragon
```

Writes `.video-export/<bundle>.mp4`: the 135×240 device screen composited into
a mock device body, 720×1280, at the device's own 10 fps, with the narration and
sfx mixed at the same balance the device plays them. Runs headless on the
virtual clock, so a 60-second story exports in well under 15 seconds.
`--out <path>` overrides the destination.

Requires ffmpeg (`brew install ffmpeg`).

**`--no-frame`** drops the body and exports the bare screen instead (540×960,
the ×4 upscale on its own, still exactly 9:16):

```sh
npm run export:video -- --bundle fixtures/knight-and-lonely-dragon --no-frame
```

The body is the default because of who receives these files. Bare 135×240 pixel
art watched on a phone reads as a low-quality video, because that is what the
viewer is implicitly comparing it against; framed, it reads as an accurate
recording of a small device. Reach for `--no-frame` when the recipient has
already held a StickS3: the frame is explanation, and they do not need it.

The body is drawn in `tools/lib/device-frame.ts` rather than committed as
artwork, since the repo keeps its art as data, not image files (the README's demo GIF, demo
video and device photos, in `docs/media/`, are the exceptions). The screen is composited at
1:1 and never rescaled, so the ×4 pixel grid stays exact. Costs about 8% file
size.

## The README's demo video

`docs/media/knight-and-lonely-dragon-kokoro.mp4` is the knight story with its committed voices:

```sh
npm run export:video -- --bundle fixtures/knight-and-lonely-dragon --out docs/media/knight-and-lonely-dragon-kokoro.mp4
```

Run it again after a change to a voice or to the story, so the video keeps up. The README plays
an uploaded copy, not this file, so upload the new one too (see the next section).

## The examples' videos

[`EXAMPLES.md`](EXAMPLES.md) shows four stories. Each has a video and a short looping GIF of one
moment, in `docs/media/examples/`:

```sh
for s in wilfred-the-friendly-dragon lulu-and-the-fringe-that-grew-back \
         noodle-the-doggie-walks-down-the-street a-dog-called-bear; do
  npm run -s export:video -- --bundle fixtures/$s --out docs/media/examples/$s.mp4
done
```

Each GIF is cut from its video with `ffmpeg`, at 360×640 and 10 fps. The start (`-ss`) and the
length (`-t`) pick the moment:

```sh
s=wilfred-the-friendly-dragon
ffmpeg -ss 11.6 -t 6 -i docs/media/examples/$s.mp4 -loop 0 \
  -vf "fps=10,scale=360:640:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  docs/media/examples/$s.gif
```

| Story | `-ss` | `-t` |
|---|---|---|
| Wilfred | 11.6 | 6 |
| Lulu | 29.5 | 7 |
| Noodle | 18.8 | 7 |
| Bear | 37.0 | 6 |

After a change to a story, export its video again, cut its GIF again, and check the times in
`EXAMPLES.md`.

The pages do not play these files. GitHub plays a video inline only from an upload, so
`EXAMPLES.md` and the README each show a `user-attachments` URL, on its own line. After you export a
video again, upload it: in the public repository, open a new issue, drag the `.mp4` into the comment
box, copy the URL GitHub writes there, and close the issue without submitting it. Then replace the
old URL. Uploads are kept by GitHub, not by this repository.

## The social preview card

GitHub shows a 1280×640 card when someone shares the repository's link. This draws two
versions from the repo's own art: `lineup`, four costumed actors under the title, and `device`,
the title beside the dragon on the device's screen.

```sh
npm run gen:social                  # -> .social-preview/lineup.png and device.png
npm run gen:social -- --out <dir>
```

Everything that matters sits inside a 60 px margin, since some sites crop the card. Upload the
one you want in the repository's settings, under Social preview. `.social-preview/` is not
committed.

## Playing it in the simulator

The local simulator runs the **same `.device.lua` bundle the hardware runs**, in the system
`lua`, with the device's portrait screen and real WAV audio:

```sh
npm run sim -- --bundle fixtures/knight-and-lonely-dragon
```

It prints a `http://127.0.0.1:<port>` URL. The page shows the StickS3 chassis (135×240 portrait
screen, two buttons where they physically sit: button 0 restarts, button 1 pauses) plus an
instrument rail with the live mixer (ch0 narration, ch1 sfx at 40%, master volume), the clock
(fps, `dt_ms`, a flag for any `play()` that skipped `preload`), transport, and a serial tail.
Browser audio needs one click to start, so press a button if the first beat is silent.

Edit sprites, the runtime, or the fixture and re-run. The sim rebuilds the bundle every start,
so there is no stale-artifact step to forget.

Useful flags:

| Flag | Effect |
|---|---|
| `--headless` | No browser. Requires `--max-ms`: an unbounded virtual clock never terminates, so `--headless` alone is rejected with an error. Rasterizes and models audio in Node; exits non-zero on a Lua error. |
| `--dump-frames <dir>` | Write every flipped frame as a PNG. |
| `--max-ms <n>` | Stop after this much simulated time. |
| `--flash-stall-ms <n>` | Delay each unpreloaded `play()`, since an SSD read understates LittleFS. |
| `--port <n>` | Fix the port instead of taking a random one. Only meaningful with a panel, so it's rejected together with `--headless`. |
| `--clock real\|virtual` | `real` follows the wall clock, the default with a panel. `virtual` runs as fast as it can, the default under `--headless`, and needs `--max-ms`. `--headless --clock real` plays at true speed with no browser. |
| `--device-id <id>` | The sim's device id. Each id keeps its own session under `.sim/<id>/`: its app and its staged story. The default is a fixed `sim-` id made from the session folder's path. |

**What the sim does not reproduce:** it has no LittleFS budget, so eviction and out-of-space
failures cannot happen there; there is no IMU auto-flip; and flash-read stalls are understated
unless you dial `--flash-stall-ms` in from a measured device number. Hardware remains the
authority on all three.

The sim runs an app in the same sandbox as the device: no `os`, `io`, `require`, `load` or
`debug`. It takes no deliveries. `push-story` and app pushes go to the device only.

## Reviewing the art

The same simulator runs the **paper-doll viewer**: the whole troupe, one actor at a time, at the
scale and grounding the stories use. Button 0 cycles expression, button 1 cycles actor:

```sh
npm run sim -- --entry viewer
```

`npm run sim:viewer` is the same command. It takes no bundle: it browses the resident troupe art, not a story. (`npm run preview:art` and
`npm run preview:layout` remain the headless contact sheets; those render through the same
compositor math without a browser.)

**The hosted Resident sim** at [resident.inanimate.tech](https://resident.inanimate.tech/#try-it-now)
can no longer run Improv apps at all: the sim build target (a buzzer-only `<bundle>.lua`
with inlined art) was retired once nothing in the authoring loop ran it. Every app now builds
for the device, reads its actor art from the resident troupe, and plays real audio, none of
which the hosted sim provides. The hosted sim remains what it always was for generic Resident
development; for an Improv app, use the local sim.

**Checking a built story app:** use the headless sim, not `/resident:validate-app`.

    npm run sim -- --bundle fixtures/knight-and-lonely-dragon --headless --max-ms 45000

It runs the app against a `troupe` module made from the real art, models the audio, plays the
story to the end, and exits non-zero on a Lua error. `/resident:validate-app` cannot check a
built story: its stubs have no troupe art, so the app's art check fails and the run crashes
before any story code runs. Use `/resident:validate-app` for hand-written Lua apps, such as
`device/apps/audio-check.lua` or the ones `/resident:create-app` writes. Run it from the repo root, so it finds
[`DEVICE-SKILL.md`](DEVICE-SKILL.md) there. The Resident plugin's directory is under
`~/.claude/plugins/cache/inanimate/resident/`.

## Changing an actor's art

The firmware holds the troupe art, not the apps (decision 7 in
[`DESIGN-DECISIONS.md`](DESIGN-DECISIONS.md)). After you change a grid under `sprites/actors/`,
regenerate the firmware's copy:

```sh
npm run gen:troupe                  # -> device/lib/drivers/src/TroupeArtData.h
```

Then rebuild the apps and reflash the device. An app and a firmware built from different art
have different fingerprints, and the app shows `Art set mismatch.` instead of the story.

## Setting up the device

A new StickS3, or one you want to reset, needs the firmware, an empty filesystem and Wi-Fi.
Connect it by USB, then:

```sh
cd device
pio run -t erase        # optional: a factory reset; deletes the firmware, Wi-Fi settings and stories
pio run -t upload       # the firmware
rm -rf data && mkdir data
pio run -t uploadfs     # an empty filesystem
```

`uploadfs` is needed because the firmware never formats its filesystem itself. Without it, every
delivery fails with `no space ... free 0`. Empty `device/data/` first: `uploadfs` copies whatever
is there, and `pack:audio` stages stories in it.

Then set up Wi-Fi. With no saved network, the device opens its own setup network, named
`Resident Improv` and the first four characters of its id. (With a saved network it cannot
reach, it tries for 20 seconds first.) Join that network, open `http://192.168.4.1`, and choose a
2.4 GHz network that your Mac is on. The StickS3 cannot use 5 GHz.

push-story needs the device id. Hold the front button while you power the device on, and the
identity screen shows it. Over USB, the boot log prints it as `[resident] Device: improv (<id>)`,
followed by `boot: no saved story` on a clean device.

## Playing it on the device

Once the StickS3 is flashed with this repo's `device/` firmware (see
[`DEVICE-SKILL.md`](DEVICE-SKILL.md) for the Lua surface it exposes), stories are delivered
**over the air**, with no USB. From a Claude Code session in this repo, invoke the **push-story**
skill with the bundle:

    push-story fixtures/knight-and-lonely-dragon

It validates the bundle, builds the device app, serves the audio over LAN HTTP
(`npm run serve:bundle`), announces a `story_fetch` to the device over the Resident relay, waits
until the device has pulled every file and checked its size and CRC32, then pushes the app via `/resident:push-app`. Re-pushing an
unchanged bundle transfers nothing and completes in seconds. Requires the device and the Mac on
the same network.

Audio moves Mac-to-device over the LAN and never touches the cloud; only the small JSON announce
goes through the relay. The device stores several stories and evicts the oldest when space runs
short, so there is no flash budget to reason about here. Delivery has gaps, listed under
[Known limits of delivery](#known-limits-of-delivery).

USB (`npm run pack:audio` + `cd device && pio run -t uploadfs`) remains only as a
firmware-provisioning path, e.g. pre-loading a story onto a freshly flashed device with no
WiFi configured. After the first setup, flashing the firmware (`pio run -t upload`, from
`device/`) is only needed when something under `device/` changes.

**Firmware dependencies are pinned, not symlinked.** `device/platformio.ini` pulls Resident and
Courier as `git+https://` deps pinned to a commit SHA, so `pio run` resolves from any checkout or
git worktree with no local setup. (Resident used to arrive as `symlink://../../resident`, which
made the firmware buildable on exactly one machine; a floating Courier HEAD then shipped a change
that silently dropped every inbound message, which is why both are now pinned. A test in
`tests/device-firmware-config.test.ts` fails the suite if any git dep tracks a moving HEAD.) The
one remaining `symlink://` line is `symlink://lib/drivers`, our own in-tree driver library.
PlatformIO stops auto-scanning `lib/` once another symlinked dependency is present, so it has to
be re-added explicitly.

To co-develop Resident against a local checkout, swap the pinned Resident line for
`symlink://../../resident` locally, but don't commit it.

## Known limits of delivery

This is a prototype, and delivery has gaps:

- **No authentication.** The device accepts a `story_fetch` or an app push from anyone who knows
  its id. The relay does not check who sent it, and the id comes from the device's Wi-Fi MAC
  address, which any nearby radio can read.
- **The Wi-Fi setup portal is open.** When the device has no saved Wi-Fi, or cannot reach it,
  Courier opens WiFiManager's setup portal: an access point with no password, whose `/update`
  page accepts new firmware. Anyone in Wi-Fi range can then flash the device. Turning the portal
  off from `main.cpp` is not enough: Courier then retries the connection on every loop, and each
  try blocks for up to 20 seconds. The fix needs a change to Courier.
- **Eviction happens first.** To make space, the device deletes the oldest stories before the
  download starts. If the download then fails, those stories are still gone. Eviction can also
  delete the story that is playing. A story that cannot fit even with every other story gone is
  refused before anything is deleted.
- **The commit is not atomic.** The device deletes the old copy of a story, then renames the new
  copy into place. If the rename fails, both copies are lost. A power cut between the two steps
  is handled: the next boot finishes the rename. That recovery has been code-reviewed but never
  run on hardware.
- **Connecting blocks the main loop.** Each file request opens a new connection inside `loop()`,
  which waits up to 5 seconds to connect. While it waits, the device does not read its buttons,
  turn its screen, or handle relay messages. The response is then read a little per tick, with
  10 seconds for its header and a time limit for each file in proportion to its size.
- **A retry can wait 49 days.** The retry timer compares `millis() < _retryAtMs`, which is not
  safe when `millis()` wraps around, about every 49.7 days. A retry scheduled just before the
  wrap then waits for almost another 49.7 days, so the download stalls. The stall checks use
  subtraction and are safe.
