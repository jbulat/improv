---
name: story-create-debug
description: Create a story with the full creation-time test pass — everything that can be checked between the child telling the story and it appearing in the local simulator. Beat-table approval before building, the complete test suite (npm test), a sim watch-through, and dual sign-off (sim run + measured export:story table). Use this for developing, debugging, testing, or replaying the story workflow end-to-end, for careful updates to existing bundles, or whenever the author wants the review gates — "replay the story-create-debug task", "debug the story pipeline", "update the dragon story properly". Runs in the local sim by default; pass --device to deliver to the StickS3 instead. For the fastest path from a child's idea to a story on screen, use story-create.
---

# Story Create Debug

This is **`story-create` plus the creation-time test pass**. Everything about the craft — the G-rating gate, the co-author stance and its one-to-three questions, casting onto the troupe, the sfx repertoire, the build chain, the headless sanity check, and where it plays — lives in **`.claude/skills/story-create/SKILL.md`**. Read that first and follow it; it is the source of truth. This file records only what is added when the story mechanics are themselves in question.

`story-create` optimises the seconds between a child speaking and a story on screen, and assumes the machinery works. Use this skill when that assumption is what you're testing: the pipeline is under development, a bundle needs a careful gated update, you're replaying the workflow end to end to watch it work, or the author has asked for the review gates. **Everything here sits between the child's idea and the local sim** — that window is the whole point of this variant. Delivery to hardware is still `--device`, and the default is still the local sim only.

## What it adds

### 1. The beat table becomes a real gate

In `story-create` the table is a record shown after playback. Here it comes first and blocks. Draft the story as a beat table in `export:story`'s columns:

| beat | seconds | actor | role | text | expression | sfx | layers |

One row per beat; `sfx` as `id@offset` (e.g. `sfx_roar@0.6s`); `layers` as `slot=id`, resolved per beat — the cast's set with that beat's override merged over it, so a staged reveal shows up as the row where the slot changes; a totals line (beat count, estimated runtime). `seconds` are **estimates** until TTS renders — say so. **Read it back as a story out loud — that is its test.** Iterate until the author says yes, and build nothing before that.

Casting in particular is shown for approval rather than silently decided: when the author describes characters ("a grumpy giant") instead of naming actors, the actor assignment is a decision they get to see.

### 2. `npm test` after the build

Insert it directly after `npm run build:app`:

```sh
npm test
```

Around 20 seconds for the whole suite. The parameterized suites pick up the new bundle automatically — `fixture.test.ts` validates every bundle under `fixtures/` both manifest-only and with `--check-files`, and `build-app.test.ts` fails if any committed `build/<name>.device.lua` has gone stale against its sources.

Two things worth knowing about what this buys, so you can judge a failure:

- Most of it re-proves what `build:app` already enforced (it runs the validator with `--check-files` internally and throws). The genuinely additional story-facing checks are **warnings treated as failures** (`fixture.test.ts` asserts zero warnings, where the CLI merely prints them), **sfx clip plausibility** (200ms–3000ms, which catches a render that came out as a click or a drone), and **committed-artifact freshness across every bundle**.
- The bulk of the suite guards the *machinery* — the Lua player's tempo and cue timing, the art-mismatch error panel, the sim, the bundle server that OTA delivery fetches from, and the firmware's rules for a hostile announce. A new story cannot break any of it. That machinery is exactly what changes during the sessions this skill is for, which is why the suite belongs here and not in `story-create`.

### 3. Sign-off is two things together

**Watch the sim start to finish yourself first** (`npm run sim -- --bundle fixtures/<name>`). This is the first time the story exists as a performance rather than a plan, and anything you would be embarrassed to hand over gets fixed here, not explained away at sign-off. The headless check in `story-create` proves it *plays*; this proves it's *good*.

**Then the author watches the same sim run, and you show the measured `export:story` table. Both, in that order.** The device draws the actor and their name and nothing else — the subtitle strip was removed when the screen went portrait, and the audio carries the words — so the sim is the only place the story is *experienced* and the table is the only place it can be *read*. The sim catches what a table cannot (pacing that drags, an sfx that lands on the wrong syllable, an expression that reads wrong on the actor); the table catches what the sim cannot (a misheard word, a cue offset a tenth of a second late). Same shape in, same shape out.

For a gated update to an existing story, the same applies: show the current table, take the changes through table approval, re-run only what the change touched (the per-change ranges are in `story-create` → "Changing it"), then re-watch and re-show.

## Debugging the pipeline

- **Validator error codes** are self-explanatory and every one is fixable at the authoring layer except a missing actor, which is a restructure conversation. `SFX_PAST_END` means a cue authored against an estimated length landed past the measured beat — re-anchor `at_ms` relative to the measured `duration_ms`, keep cues ascending, re-validate. **Never hand-edit `duration_ms`**; it is measured truth from the rendered clip, and `gen:audio --write-durations` is what sets it (along with every speaking beat's duration, as clip + 300ms).
- **A cue that is merely mistimed passes every check.** `gen:audio` warns when a re-render moves a clip's length on a beat carrying `sfx`, because those `at_ms` offsets were authored against the old clip and nothing rescales them (`tools/lib/cue-drift.ts` says why rescaling would be wrong). The validator cannot catch this — `SFX_PAST_END` only fires once a cue is past the end of its beat, and frame dumps show art, not audio timing. The warning is the only signal; act on it by ear with `preview:audio`. Recasting the Lulu Witch from ada to rosa is the worked example: the clip went 2136ms → 1649ms and the sparkle cue at 1400ms slid from a pause into the middle of "BALD!".
- **The validator changes nothing underneath you.** It only reports, and `build:app` refuses a story with an error. The snap / drop / bounce / reject classes in `improv-design.md` are the design for the cloud pipeline, which was never built.
- **`build:app` is the only build there is** — the old `--target sim` was retired. It produces `device-apps/improv/build/<name>.device.lua`, a committed, inspectable artifact that both the hardware and the sim run. If it goes stale, the device plays the *old* story or shows `Art set mismatch.` on screen.
- **The sim rebuilds the app on every start** and validates with `--check-files`, so there is no prior build step to remember and no stale artifact to run by mistake. What it does not reproduce: no flash budget, so eviction and out-of-space cannot happen there; no IMU auto-flip; flash-read stalls are understated. Hardware remains the authority on delivery.
- **The device's own storage engine is untested.** `device/lib/drivers/src/StorySync.cpp` — free-space checks, LRU eviction, the per-tick read budget, `.index` reconciliation after a mid-fetch power loss — has no test. Only its announce rules (`StorySyncCore.h`) run on the host, against a case table. `no space: … nothing to evict` and similar are hardware-only findings, so reach for the push-story troubleshooting table rather than the test output.
- **The hosted Resident sim** (https://resident.inanimate.tech/#try-it-now) cannot run Improv apps anymore: every build reads resident troupe art and plays clip audio, and the hosted sim has neither. It is a generic Resident development surface only — never send an author there. The local sim is the review surface.
- **Reviewing art** rather than a story — `npm run sim -- --entry viewer` browses the whole troupe as a paper doll. Button 0 cycles expression, button 1 cycles actor; it takes no bundle.
- **Fixture negatives** live in `fixtures/invalid/` (one per validator rule, regenerated by `npm run gen:invalid`) — the living documentation of the semantic checks, and the place to add one when a new rule lands.

## References

- `.claude/skills/story-create/SKILL.md` — the craft, the constraints, the build chain, and the `--device` parameter. Start there.
- `WORKFLOWS.md` — the command loops both skills drive.
- `schema/performance.schema.json` + `tools/lib/validator.ts` — the contract and its error codes.
- `tests/fixture.test.ts` — what `npm test` actually checks about a bundle.
