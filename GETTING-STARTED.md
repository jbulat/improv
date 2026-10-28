# Getting started

The shortest path from a fresh clone to watching a story in the simulator, and a map of what's
where. For every other tool, see [`WORKFLOWS.md`](WORKFLOWS.md).

## What you need

**No hardware is needed to watch a story.** The local simulator runs the same app the device
runs, in your browser. The device is only needed to play a story on the StickS3 itself.

This is built around a specific, deliberately low-cost stack. The device is a **playback terminal, not an inference engine**: there is no on-device AI.

| Layer | Choice | Role |
|---|---|---|
| Device | **M5 StickS3** (ESP32-S3, 8MB PSRAM, 1.14" LCD, IMU, mic/speaker, IR, battery) | Displays sprites, plays audio. Playback only. |
| On-device runtime | **Resident** (Inanimate) | C++ sandboxed **Lua** runtime with hot-reload over WebSocket. The playback app is Lua, pushed from the cloud. |
| Connectivity | **Courier** (composed by Resident) | WiFi, WebSocket, MQTT, UDP multicast, self-healing reconnection. |
| Cloud | Designed, not built | All AI (STT, story LLM, director LLM, TTS) plus the asset pipeline. In this prototype the Claude Code skills and macOS `say` stand in for it. |
| Dev workflow | **Claude Code** + the Resident agent plugin | Flash firmware, write the device driver layer, iterate Lua apps via hot reload. |

**Note on Resident:** it's a library you compile into firmware, not a flash-and-go OS. Standing up a new device is a one-time job: bring up the board in PlatformIO, add the sandbox, write C++ drivers that expose the StickS3's hardware (LCD, buttons, audio, buzzer) to Lua, and document that surface in a `DEVICE-SKILL.md`. That's done now: this repo owns a `device/` PlatformIO project and a repo-root [`DEVICE-SKILL.md`](DEVICE-SKILL.md). Standing up the driver layer happened on Resident, in this repo, not by depending on the upstream demo. After that, the fast loop is pushing Lua apps over the air.

## Install

Prerequisites: Node 20 or later and `npm ci`, plus a `lua` interpreter on PATH (`brew install lua` on macOS; verified against 5.4 and 5.5). The headless Lua tests and `build:app`'s syntax check both shell out to it. The pure TypeScript tools (validate, preview:art, preview:audio, export:story) do **not** need Lua. The test suite also needs a C++ compiler (`c++`, for the firmware's host tests) and a git checkout, and two of its tests fail when it runs as root, because root ignores the file permissions they rely on. Rendering line audio (`gen:audio`) needs Kokoro and ffmpeg; see below.

```sh
npm ci
```

## Voices

The spoken line clips (`fixtures/*/audio/aud_*.wav`) are in the repo, so a fresh clone plays
every story with voices. They are rendered with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M),
an open text-to-speech model. To render new or changed lines, install it once. It needs
`python3`, `curl` and ffmpeg, and takes about 340 MB in `~/.local/share/kokoro` (set
`KOKORO_HOME` to put it elsewhere):

```sh
npm run setup:kokoro
npm run gen:audio:all             # re-render every bundle's clips
```

`gen:audio:all` keeps the lengths in `performance.json`, and warns if a clip renders to a
different length; add `-- --write-durations` to accept the new lengths.

Each actor's voice is set in `KOKORO_VOICES` in `tools/gen-line-audio.ts`. Kokoro uses the same
schema and durations mechanism as a cloud TTS would, so swapping one in is a render-stage change
only.

## Watch a story

```sh
npm run sim -- --bundle fixtures/knight-and-lonely-dragon
```

It prints a `http://127.0.0.1:<port>` URL to open. Browser audio needs one click to start, so press a button on the simulated device if the first beat is silent. [`WORKFLOWS.md`](WORKFLOWS.md#playing-it-in-the-simulator) explains the panel and its flags.

## Tests and CI

```sh
npm test                                    # full suite
npm run all                                 # what CI runs: typecheck, lint, format check, full suite, viewer build
npm run lint                                # ESLint
npm run format                              # Prettier: the TypeScript, the JavaScript, the sim panel
npm run format:cpp                          # clang-format on the C++ (needs clang-format 19.1.7: pip install clang-format==19.1.7)
npm run validate -- fixtures/knight-and-lonely-dragon/performance.json --check-files
npm run gen:sfx -- --bundle fixtures/knight-and-lonely-dragon     # regenerate the bundle's chiptune sfx (deterministic)
npm run gen:audio -- --bundle fixtures/knight-and-lonely-dragon --write-durations   # re-render one bundle's voice clips + patch durations
npm run build:app -- --bundle fixtures/knight-and-lonely-dragon   # -> device-apps/improv/build/knight-and-lonely-dragon.device.lua
npm run build:viewer                        # bundle the sprite viewer (art review)
npm run sim -- --entry viewer               # browse that art, actor by actor
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and every push to `main`. It has two jobs:

- **Typecheck, test and build.** Installs Lua and ffmpeg, checks the C++ formatting with clang-format 19.1.7, runs `npm run all` (typecheck, ESLint, the Prettier check, the full test suite, the viewer build), then rebuilds every story app and fails if a committed build file is out of date.
- **Build the StickS3 firmware.** `pio run -d device`, with the PlatformIO toolchain cached between runs. It runs only when the repository variable `FIRMWARE_CI` is `true`; otherwise it is skipped.

## Repository map

The contract and its tooling are real:

| Path | What it is |
|---|---|
| `schema/performance.schema.json` | The frozen shape contract for a `Performance` (JSON Schema, `schema_version: 2`) |
| `troupe/troupe.json` | The casting catalog as data: actors, expression sets, sfx vocabulary, voice ids |
| `fixtures/knight-and-lonely-dragon/` | The reference Performance, written with AI from a two-sentence brief to exercise casting, props and sound (storyboard Draft A) + its audio bundle |
| `fixtures/meet-the-troupe/` | The onboarding performance: Miss Moon introduces the troupe, every actor playing themselves; the first full-troupe (7-cast) bundle |
| `fixtures/biscuit-comes-home/` | A princess loses her dog Biscuit and a prince brings her home; authored from a child's idea through the `story-create-debug` skill, and the first story delivered idea-to-played entirely over the air |
| `fixtures/<story>/` | Five more story bundles: `a-dog-called-bear`, `just-you-wait`, `lulu-and-the-fringe-that-grew-back`, `noodle-the-doggie-walks-down-the-street`, `wilfred-the-friendly-dragon` |
| `fixtures/invalid/` | Broken fixtures for 21 of the 23 error rules: living documentation of the semantic checks |
| `tools/validate.ts` | The deterministic validator both tracks build against |
| `tools/preview-art.ts` | Headless character-art preview → a PNG contact sheet (`npm run preview:art`) |
| `tools/preview-audio.ts` | Mixes a bundle's timeline into one WAV so a story can be heard on a computer (`npm run preview:audio`) |
| `tools/export-story.ts` | Emits a story's timeline as a review/debug table, Markdown or CSV (`npm run export:story`) |
| `tools/sim.ts` | The local simulator: runs a built device app in a real `lua` process, with the device's screen, buttons and two-channel audio (`npm run sim`) |
| `tools/export-video.ts` | Records a story from the simulator as an MP4 (`npm run export:video`) |
| `tools/build-app.ts`, `tools/gen-*.ts` | The build: the device app, the sfx, the line audio, the firmware's troupe art header and the invalid fixtures |
| `tools/serve-bundle.ts`, `tools/pack-audio.ts` | Delivery: serve a bundle's audio over the LAN for an over-the-air fetch, or pack it for a USB upload |
| `sprites/` | The troupe's pixel art as text grids: the palette, each actor's base and expression overlays, and the shared layer art under `layers/` (headwear, back props, front props) |
| `device-apps/improv/` | The playback app: Lua runtime sources (`src/`) + `build/<bundle>.device.lua` ← generated bundle, one per story (committed, inspectable), plus `build/viewer.lua`, the art-review paper doll |
| `device/` | The repo-owned PlatformIO firmware project for the StickS3: C++ drivers that expose the screen, buttons, buzzer and audio to Lua, the resident troupe art, over-the-air story sync, and the store that restores the last app at boot, plus the `audio-check.lua` bring-up app |
| `DEVICE-SKILL.md` | The StickS3's Lua module surface, documented for both `/resident:validate-app`/`/resident:create-app` (auto-discovered from the repo root) and human authors |
| `.claude/skills/story-create/` | **The default story skill.** Co-write a story from a child's idea, cast it on the troupe, build the bundle, sanity-check it headlessly and play it in the local sim: the full authoring craft, optimised for the seconds between a child speaking and seeing their story. No approval gates, no machinery tests; `--device` delivers to the StickS3 instead |
| `.claude/skills/story-create-debug/` | The same work with the full creation-time test pass, for developing and debugging the pipeline: beat-table approval before building, `npm test`, dual sign-off, and the validator/sim debugging notes |
| `.claude/skills/push-story/` | Delivers a story to the StickS3 over the air: serves its audio on the LAN, announces it over the relay, waits for the device to verify every file, then pushes the app |
| `tests/` | The test suite (`npm test`): the validator, the build, the Lua runtime played headlessly, the simulator, and the firmware's host-testable C++ |

Everything else, from art previews to delivering a story to the device, is in [`WORKFLOWS.md`](WORKFLOWS.md).
