# Device Track, Part 3 — Over-the-Air Story Delivery (Design)

**Date:** 2026-07-20
**Status:** Shipped and merged (2026-08-05, PR #22); complete as of 2026-08-06. Five of the six
success criteria are met and the sixth was retired — see the annotated list at the bottom of this
file. Criterion 2 (a brand-new story from a child's idea to playing on hardware, no USB) was the
last one open; it was blocked on app size until troupe art became resident in firmware, and
passed on 2026-08-06 with `fixtures/biscuit-comes-home/`. Two crash-window recovery paths added
by the Task 6 hardening remain code-reviewed but unexercised on hardware, and the device's
resident story set has never been read back directly — both are recorded in the plan's hardware
checklist and in the README.
**Amended:** 2026-07-23 — the originally proposed `direct-story` skill is dropped: the `story-director` skill (spec `2026-07-22-meet-the-troupe-and-story-skill-design.md`) shipped in the meantime and covers that ground better. Part 3 now delivers `push-story` and rewires `story-director`'s device run loop onto it.
**Scope:** Remove USB from the story loop. The device grows a story-sync path: a JSON message over the *existing* Resident/Courier WebSocket announces a bundle, and the device HTTP-pulls its audio onto the same `stories/<bundle>/` LittleFS paths the audio driver already reads. One new agent skill, `push-story` (bundle → device, over the air), becomes the delivery primitive the existing `story-director` skill delegates to. Three deliverables: (1) a `StorySync` firmware extension + the `story_fetch` protocol; (2) `tools/serve-bundle.ts`, the ephemeral HTTP server and manifest generator; (3) the repo-local `push-story` skill + the `story-director` run-loop edit that retires USB from story delivery.

Out of scope: a story-agnostic player and on-device story picker (the per-story Lua app still arrives via `push-app`), synchronized multi-device *playback* (v4 — though `push-story` targets N devices from day one), real TTS (the render step stays macOS `say`), any standing or cloud server (the announce + manifest protocol is written down so the future cloud Distribute stage can adopt it; building that stage is the cloud track's job), any change to the Performance schema, the `audio.*` API, or the playback runtime.

## Where Part 2 left the board

The device plays both committed stories from local flash, and its `audio.*` API and `stories/<bundle>/` filesystem convention don't care how bytes arrived. Courier is already compiled in and running — Resident composes it, and the StickS3 holds a live WebSocket to `wss://resident.inanimate.tech/devices/<device-id>`, with `POST https://resident.inanimate.tech/devices/<id>/send` as the documented way for skills and curl to reach it. Custom JSON types already flow to `sandbox.onMessage`. So "bring up Courier" is done; Part 3 is exactly the delta: use the pipe that exists to deliver stories, and retire `pio run -t uploadfs` to a firmware-only tool.

The one step of the story pipeline that cannot be an agent skill today is moving the WAVs (USB, main checkout, whole-partition reflash). Everything else already is one: the `story-director` skill spans Author and Direct (co-author interview, casting, the beat-table review contract, render, validate, build), and its run loop pushes apps over the air — but its *device* path still ends in `pack:audio` → `uploadfs` over USB. Part 3 closes exactly that gap, so the skills that exist become a fully over-the-air pipeline — the interim cloud.

## Decisions made

| Decision | Choice |
|---|---|
| Bulk wire | Ephemeral HTTP pull on the LAN. The `push-story` skill starts a throwaway server on the Mac, announces the URL through the relay, the device pulls, the skill stops the server. No standing infra. |
| Control wire | The existing Resident relay WebSocket. One custom message type, `story_fetch`, carrying bundle id, base URL, and a per-file manifest (path, size, CRC32). |
| What moves | Audio only. Timeline + sprites stay baked into the per-story Lua app, pushed OTA via `push-app` as today. One new variable, per the roadmap. |
| Atomicity | Fetch into `stories/<bundle>.tmp/`, verify every file, then rename over `stories/<bundle>/`. A half-fetched story can never corrupt a playable one. |
| Idempotence | On completion the device writes `stories/<bundle>/.manifest.json`. A `story_fetch` whose manifest matches it is answered "already have it" — repeat pushes of unchanged audio are near-instant. |
| Eviction | Oldest-fetched-first, tracked in a small `stories/.index` file (LittleFS has no timestamps). Evict only when the incoming bundle needs the space; fail loudly if it still doesn't fit. |
| Fetch execution | A non-blocking state machine in the extension's `update()` — bounded read slices per tick so Courier's loop and heartbeat stay serviced mid-fetch. Progress on the LCD. |
| Lua surface | None. By the time the app is pushed, the audio is already where `audio.*` expects it. `StorySync` is a `Resident::Extension`, not a `Driver`. |
| Completion signal | Primary: the ephemeral server observes every manifest file being served. Secondary (best-effort): the device sends `story_fetch_done` / `story_fetch_failed` back over the WebSocket, and shows the outcome on the LCD. |
| Transport security | Plain HTTP, no TLS, no auth. Children's story audio on your own LAN, served for seconds at a time. Manifest paths are sanitized (no `..`, no absolute paths) so a message can only ever write under `stories/`. |
| Skills | One new skill, `push-story` (bundle → device(s)), repo-local under `.claude/skills/`. The existing `story-director` keeps the authoring/directing half and its device run loop delegates to `push-story`. Layered: story-director never learns the fetch protocol; push-story never learns casting rules. |
| Multi-device delivery | `push-story` accepts N device ids; the announce is per-device, the server serves all comers. Free now, needed for v4 later. |

## Why these choices

- **HTTP pull, not relay chunks, not a depot server.** A story is ~1.7 MB of WAVs. Base64-chunking that into ~150 JSON messages through inanimate's dev relay — infra sized for pushing Lua apps — is slow, fragile, and rude. A standing WebSocket depot server means inventing a chunk/ack protocol on both ends for what HTTP already does: per-file transfer, ranged retries, and a dumb server. The cost is a LAN-reachability requirement (device and Mac on the same network), which is exactly the dev situation Part 3 lives in. The relay keeps the job it's good at — small JSON control messages to a device anywhere.
- **Courier's real contribution is already sunk, and its future one is v4.** Connectivity (WiFi config, reconnection, message routing) landed with Part 2 via Resident. Part 3 spends that asset as the control plane. Where Courier becomes irreplaceable is multi-device sync — targeted delivery now, UDP-multicast start cues later — which is why the announce protocol is per-device from the start.
- **Audio-only keeps Part 3 one variable.** Moving the timeline out of the Lua app means a data format, an on-device story picker, and eviction UX — a player rearchitecture, not a delivery mechanism. `push-app` is already OTA; the only USB-bound bytes are the WAVs. Deliver those and the roadmap's promise ("layered onto a device that already plays perfectly offline") is kept literally: if the fetch fails, the device still plays whatever it had.
- **On-device eviction absorbs the staging-budget problem.** The story-director spec already flags that three stories may exceed the LittleFS budget, leaving `pack:audio`'s over-budget refusal as the roadblock. With OTA delivery the device manages its own space: the library lives on the Mac, the device holds the most recently delivered stories, and any single story needs only to fit alone. (The story-director spec's deferred "shared sfx staging" optimization remains open, just less urgent.)
- **tmp-then-rename is the whole integrity story.** Flash writes fail, WiFi drops, batteries die. Every failure mode either leaves a `.tmp` dir (deleted on next boot and next fetch) or a fully verified bundle. There is no third state, so there is nothing to repair.
- **The server as progress oracle.** Whether the relay exposes device→skill events is not a dependency worth taking: the server the skill just started sees every GET, so "all manifest files served, then `push-app` succeeded" is an observable acceptance chain using only things the skill owns. Device-side events ride along as best-effort confirmation and appear in serial/telemetry regardless.
- **Skills are the interim cloud.** The user's next goal is prose → directed → validated → distributed → played. `story-director` is already Claude doing the Author + Director jobs against the same contract the cloud LLM will target (`troupe.json`, the casting rules, the validator); `push-story` speaks the same announce + manifest protocol a cloud Distribute stage would. When the cloud track lands, it replaces the *executors* of these steps, not the contracts.
- **`push-story` is its own skill, not a story-director step.** Authoring failures (miscast roles, validation errors) and delivery failures (device offline, LAN unreachable) are different conversations, and "put lighthouse-and-fog on both devices" shouldn't require a story interview. Delivery stays independently invokable and testable against the committed fixtures with no LLM authoring involved; story-director calls it by name, mirroring how it already calls `/resident:push-app`. This also honors story-director's own anti-drift rule — skills hold pointers, not copies.

## The protocol

One message type in, two out. The announce, POSTed to the relay per target device:

```json
{
  "type": "story_fetch",
  "bundle": "lighthouse-and-fog",
  "base_url": "http://<lan-ip>:8123/lighthouse-and-fog/",
  "files": [
    { "path": "aud_000.wav", "size": 118262, "crc32": "9a3f01c2" },
    { "path": "sfx_bark.wav", "size": 22050, "crc32": "0e77b19d" }
  ]
}
```

`files` is the bundle's staged WAV set — the same set `pack:audio` stages, derived from the validated `assets.audio` manifest. Paths are relative to both `base_url` (for the GET) and `stories/<bundle>/` (for the write); the device rejects any path containing `..` or starting with `/`. The ~14-file manifest keeps the announce a few KB — well inside JSON-message territory.

The device answers over its WebSocket (best-effort):

```json
{ "type": "story_fetch_done",   "bundle": "lighthouse-and-fog", "already": false, "bytes": 1700000, "ms": 21000 }
{ "type": "story_fetch_failed", "bundle": "lighthouse-and-fog", "reason": "crc32 mismatch: aud_003.wav", "file": "aud_003.wav" }
```

This announce + manifest shape is the Distribute contract the cloud track inherits: a future server changes `base_url` to its own origin and the firmware is untouched.

## The firmware: `StorySync`

A `Resident::Extension` in `device/lib/drivers`, handed the display driver for progress rendering. `main.cpp`'s `sandbox.onMessage` handler forwards `story_fetch` to it (the reserved Resident types never reach that callback, so there is no routing conflict).

State machine, driven from `update()`:

1. **Idle → Check.** Parse and sanitize the manifest. If `stories/<bundle>/.manifest.json` exists and matches (same file set, sizes, CRCs), GET `<base_url>.already` — a sentinel endpoint the server logs and answers 204 — then reply `story_fetch_done { already: true }` and stop. The sentinel keeps the server log a uniform completion oracle even when no audio moves. A `story_fetch` arriving mid-fetch for a different bundle is rejected (`story_fetch_failed { reason: "busy" }`); for the same bundle it restarts the fetch.
2. **Check → Space.** Sum manifest sizes + slack against LittleFS free space. If short, delete other `stories/<x>/` directories oldest-first per `stories/.index` until it fits; if it still doesn't, fail with the math in the reason.
3. **Space → Fetch.** Delete any stale `stories/<bundle>.tmp/`, then fetch files sequentially with the Arduino `HTTPClient`, streaming each response to `stories/<bundle>.tmp/<path>` in bounded slices (~16–32 KB per `update()` tick) while accumulating CRC32 (ESP32 ROM implementation). Bounded slices keep the main loop responsive so Courier's heartbeat and the LCD stay live; at LAN speeds the story lands in tens of seconds. Per-file: verify size + CRC on completion; on mismatch or HTTP/socket error, retry up to 3 times with short backoff; then fail the fetch.
4. **Fetch → Commit.** Write `.manifest.json` into the tmp dir, remove any existing `stories/<bundle>/`, rename tmp → final (LittleFS renames directories atomically), append the bundle to `stories/.index`, reply `story_fetch_done`, show "Story ready" on the LCD.
5. **Any → Failed.** Delete the tmp dir, reply `story_fetch_failed`, show the failure on the LCD. Old stories are untouched by construction.

During a fetch the LCD shows bundle name, file counter, and a byte-progress bar ("Fetching lighthouse-and-fog… 4/14"). A running Lua app keeps ticking — its story's audio is already in PSRAM, and its screen updates will interleave with progress frames; that visual scruff is accepted, because `push-story` replaces the app moments later anyway. On boot, `StorySync` deletes any leftover `*.tmp` directories.

## The ephemeral server: `tools/serve-bundle.ts`

One tool, two jobs — the manifest and the bytes:

- **`--manifest`**: validate the bundle (`--check-files`), resolve the staged WAV set exactly as `pack-audio.ts` does (the staging-set logic is extracted into a shared helper so the two tools cannot drift), compute per-file size + CRC32, and print the manifest JSON. `push-story` embeds this in the announce.
- **Serve mode** (default): serve the bundle's staged file set read-only at `/<bundle>/<path>` on `--port` (default: random high port), plus the `/<bundle>/.already` sentinel (204, logged), refusing anything else (404). Print the chosen base URL using the machine's first non-internal IPv4 (`--host` overrides, for multi-homed Macs or VPNs). Log one JSON line per request (`{path, status, bytes, remote}`) to stdout so the skill can tail progress. Exit on SIGTERM or `--timeout` (default 10 min).

No framework — Node's `http` module and a path allowlist. Unit-tested like every other tool.

## The skills

Repo-local under `.claude/skills/`, so they version with the contract they drive.

**`push-story`** (new) — args: `--bundle <dir>`, `--device-id <id>[,<id>…]` (defaults to `<device-id>`).
1. Validate the bundle; run `build:app --target device` if the built `.device.lua` is stale or missing.
2. `serve-bundle --manifest` → the file list; start `serve-bundle` in the background; note the base URL.
3. POST the `story_fetch` announce to the relay for each device id.
4. Tail the server log until, per device, either every manifest file has been served or the `.already` sentinel was hit. If no progress for 60 s, re-announce (idempotent); give up at 5 min with a diagnosis (device offline? different network? `--host` wrong?).
5. `/resident:push-app` the `.device.lua` to each device.
6. Stop the server; report per-device outcomes.

**`story-director`** (existing — edited, not rewritten). Its run loop's device path currently reads `pack:audio` → `uploadfs` → `--target device` build → push. That becomes: build `--target device` if stale, then *invoke `push-story`*. `uploadfs` moves to a firmware-provisioning footnote. The sim path, the interview, the review contract, and the update path are untouched — the update path gets OTA delivery for free, since re-running a story ends in the same run loop. Repeat pushes after a text-only tweak still re-render audio, so they transfer normally; a re-push with unchanged audio is the near-instant `already` case.

The demo the part exists for: a child's idea goes through `story-director`, then `push-story`, to a playing device — no USB cable in sight.

## Repo layout (new and changed)

```
device/
  lib/drivers/src/StorySync.{h,cpp}   ← NEW: Resident::Extension — story_fetch state machine
  src/main.cpp                        ← + onMessage forwarding to StorySync; boot-time tmp cleanup hook
tools/
  serve-bundle.ts                     ← NEW: manifest generation + ephemeral HTTP server
  pack-audio.ts                       ← staging-set logic extracted to a shared helper (behavior unchanged)
.claude/skills/
  push-story/SKILL.md                 ← NEW: bundle → device(s), over the air
  story-director/SKILL.md             ← EDIT: device run loop delegates to push-story; uploadfs demoted
```

`partitions.csv`, `AudioDriver`, the runtime, the schema, and both build targets are consumed, not modified. README's "Playing it on the device" section is rewritten around the skill pair, with `uploadfs` demoted to firmware-provisioning notes.

## Error handling

- **Skill-time: strict.** `push-story` refuses an unvalidated bundle or a missing device build (it builds rather than pushes stale). `serve-bundle` refuses to serve a bundle that fails `--check-files`.
- **Fetch-time: atomic and loud.** Every failure path deletes the tmp dir, leaves prior stories intact, reports a reason both on the LCD and over the WebSocket, and is retried from scratch by an idempotent re-announce. Insufficient space fails with the byte math after eviction has done what it can.
- **Play-time: unchanged.** The Part 2 philosophy holds — a missing clip is a warned, silent beat. But the delivery design makes that path unreachable for fetched stories: the app is only pushed after the server has seen the full manifest served.

## Testing

- **TS unit tests:** manifest generation (paths/sizes/CRC32 golden values against the knight fixture; parity with `pack:audio`'s staging set via the shared helper), CRC32 implementation vectors, server behavior (serves exactly the allowlisted set, 404s outside it, JSON request logging, `--timeout` exit), announce construction.
- **Firmware:** no host-side harness (as Part 2). M0's exercise path is `serve-bundle` + a hand-curled announce, watched over serial; the state machine's branches (already-have-it, busy, CRC mismatch, space/eviction, mid-fetch power cut) are an on-hardware checklist driven by deliberately doctored announces (wrong CRC, oversized `size`, hostile paths).
- **Skills:** exercised end to end — `push-story` with committed fixtures (including the repeat-push already-have-it case and an eviction case across three staged stories), then `story-director` authoring a brand-new story whose run loop delivers via `push-story` — the combined idea-to-played run.

## Milestones

Each ends with something observable.

1. **M0 — One file over the air.** `StorySync` skeleton + `serve-bundle` serving the knight bundle; a hand-curled `story_fetch` with a one-file manifest lands `aud_000.wav` in a tmp dir, verified by CRC, watched over serial. Proves relay → onMessage → HTTP GET → LittleFS write, and measures LAN throughput (calibrates the slice size and the stall timeout).
2. **M1 — A whole story, atomically.** Full manifest fetch with progress on the LCD; tmp → rename commit; `.manifest.json` + `.index` written; re-announce answers `already`; doctored-announce failure cases pass the checklist; eviction proven by fetching both stories into the ~4.3 MB partition twice over.
3. **M2 — `push-story`, no cable.** The skill delivers `lighthouse-and-fog` (audio fetch + app push) to `<device-id>` end to end, with the USB cable physically unplugged after the one-time firmware flash. Repeat push is near-instant. This also closes Part 2's leftover: the second story playing on the physical device.
4. **M3 — Idea to played.** `story-director`'s run loop is rewired onto `push-story`; a new story authored through it plays on the device without USB — a story that existed nowhere an hour earlier. README rewritten around the loop.

## Success criteria

1. A story reaches the device with no USB connection: audio over HTTP, app over the relay, triggered by one skill invocation.
2. A brand-new story goes from a child's idea to playing on the StickS3 via `story-director` + `push-story`, passing the same validator as the hand-authored fixtures.
3. Delivery is atomic: no sequence of failures (WiFi drop, power cut, bad bytes) leaves the device unable to play a previously delivered story.
4. Repeat delivery of an unchanged bundle transfers no audio and completes in seconds.
5. ~~`push-story` handles two device ids in one invocation (delivery only; synchronized playback stays v4).~~ **RETIRED 2026-08-06** — never run (only one StickS3 exists) and since decided not to be required. `push-story` still accepts N device ids, so the capability is there; it is simply not a criterion this project has to meet.
6. `npm test` covers the manifest, CRC, server, and staging-set parity; the sim workflow and Part 2 hardware behavior are untouched.

## Risks

| Risk | Mitigation |
|---|---|
| Blocking flash/HTTP work starves Courier's loop and drops the WebSocket mid-fetch | Bounded read/write slices per `update()` tick; M0 measures real slice cost and tunes; the fetch survives a WS drop anyway (HTTP is a separate socket) and the announce is idempotent. |
| Device and Mac not mutually reachable (guest WiFi isolation, VPN, multi-homed Mac) | `--host` override; `push-story`'s stall diagnosis names this cause explicitly; M0 proves the path on the real home network before anything builds on it. |
| LittleFS directory rename is not atomic under power loss | littlefs metadata operations are power-loss-safe by design; the checklist's mid-fetch and mid-commit power cuts verify observable behavior (worst case: tmp dir cleaned at boot, prior story intact). |
| Relay message-size or rate limits bite the announce | The announce is a few KB — smaller than the Lua apps already pushed daily. If a future story's manifest outgrows it, the manifest moves behind `base_url` and the announce carries only its URL + CRC (noted in the protocol section as the escape hatch). |
| The open relay means anyone who knows the device id can trigger fetches | Accepted for the dev relay era (same exposure as `push-app` today); path sanitization bounds the blast radius to writing WAVs under `stories/`. Revisit when the cloud track stands up its own authenticated endpoint. |
| The `story-director` edit drifts from that skill's own spec | The edit touches only the run loop's device path (one delegation line) — the interview, review contract, and update path are explicitly out of bounds; the 2026-07-22 spec remains that skill's authority. |

## What the cloud track inherits

The Distribute contract, in running code: a manifest + announce protocol (`story_fetch` / `story_fetch_done` / `story_fetch_failed`), a device that fetches, verifies, and commits atomically from any `base_url`, and a skill pair (`story-director` + `push-story`) whose *steps* — direct against the troupe contract, render, validate, serve, announce, push — are exactly the stages the cloud pipeline will execute for real. The cloud replaces the executors; the contracts, the validator, and the firmware stand.
