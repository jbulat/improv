---
name: push-story
description: Deliver a story bundle to one or more Improv StickS3 devices over the air — audio over LAN HTTP, app over the Resident relay, no USB. Use when asked to push, load, deliver, or sync a story onto the device(s), including "put this on both devices". Takes a bundle directory under fixtures/ and optional device ids.
---

# Push Story

Delivers a validated bundle with no USB cable: `serve:bundle` serves the WAVs on the LAN, a
`story_fetch` announce over the Resident relay tells each device to pull them, the server's
request log confirms delivery, then the built device app goes over via `/resident:push-app`.

Audio never leaves the LAN. Only the small JSON announce goes through the cloud relay.

**Preconditions**

- The device runs this repo's `device/` firmware with StorySync (part 3 or later).
- The device and this Mac are on the **same network**. The StickS3 is **2.4 GHz only** — a
  5 GHz-only network or an iPhone hotspot without "Maximize Compatibility" will not work.
- `jq` is installed (steps 5–6 use it; `/resident:push-app` requires it too).
- Relay and device id — export these once, as real shell variables the `curl` commands below
  refer to (unlike the `<name>`/`<lan-ip>` prose placeholders elsewhere in this skill, which you
  substitute by hand as you read):

  ```bash
  export RELAY=https://resident.inanimate.tech DEVICE=<device-id>
  ```

  Replace `<device-id>` with your StickS3's id. To read it, power-cycle the device with the
  front button held: the identity screen shows it. The relay URL is the hosted-relay default.
  The local simulator takes no deliveries, so the target is always the device. One rule covers
  the whole file: `$RELAY`/`$DEVICE` are real shell variables
  where a `curl` command actually expands them; everywhere else the same two values appear as
  the hand-substituted placeholders `<relay-url>` and `<device-id>` — swap them in yourself, the
  same as `<name>` or `<lan-ip>`.

This skill is deliberately defensive. The checks below each exist because their absence cost
real debugging time on hardware. Do not skip them.

## Steps

### 1. Validate and build

Stop on any error. Never deliver an unvalidated bundle.

```bash
npm run validate -- fixtures/<name>/performance.json --check-files
```

```bash
npm run build:app -- --bundle fixtures/<name>
```

That writes `device-apps/improv/build/<name>.device.lua`.

### 2. Note the Mac's current LAN IP

Do this **every run**, not once. A stale IP is the single most common failure (see step 5).

```bash
ipconfig getifaddr en0
```

If that prints nothing, the Mac is not on Wi-Fi — try `en1`, or `ifconfig | grep 'inet '`.
Call the result `<lan-ip>`.

### 3. Capture the manifest

`--silent` is **required**. Without it npm writes a `> serve:bundle` preamble into the
redirected file and every later `jq` call dies with `Unexpected end of JSON input`.

```bash
mkdir -p /tmp/push-story && npm run --silent serve:bundle -- --bundle fixtures/<name> --manifest > /tmp/push-story/manifest.json
```

The flag is `--bundle <dir>`. A bare positional bundle path fails with `unexpected argument`.

### 4. Start the server

Pin the port and raise the timeout. The default port is `0` (a fresh random port every run,
which invalidates a saved announce) and the default timeout is 600s (the server quietly
self-terminates mid-session and the next announce fails confusingly).

```bash
npm run serve:bundle -- --bundle fixtures/<name> --port 8787 --host <lan-ip> --timeout 3600 > /tmp/push-story/serve.log 2>&1 &
```

Do not record `$!` to stop the server later, and do not reach for `kill %1`. Neither one
reaches the listener. `npm run` is the top of a three-process chain — npm spawns `tsx`, which
spawns the node process that actually binds the socket — so `$!` names npm, two levels above
the only process holding port 8787. Job control is also off in non-interactive shells, so `%1`
is not a valid job there. The pinned port is the handle instead, and step 10 stops the server
through it.

The `serving` line is the authoritative base URL — read it, do not assume it. Grep for it
rather than taking the first line: npm prints a two-line `> serve:bundle` preamble ahead of it,
so `head -1` returns `> serve:bundle`.

Poll for it rather than sleeping a fixed amount. `tsx` startup is not instant and varies with
machine load, so a `sleep` long enough on one machine returns an empty grep on another — and
step 5 then reports `HTTP 000` against a server that was merely still binding, which reads like
a firewall problem rather than a race. This waits up to 30s and says so if the server never
came up:

```bash
for _ in $(seq 60); do
  grep -m1 '^serving ' /tmp/push-story/serve.log && break
  sleep 0.5
done
grep -q '^serving ' /tmp/push-story/serve.log || { echo "serve:bundle never came up:"; cat /tmp/push-story/serve.log; }
```

Expect `serving http://<lan-ip>:8787/<name>/`. The URL after `serving ` is `base_url`. If the
fallback fires instead, the log holds the reason — a port already in use is the common one.

`--host` matters when the Mac is multi-homed or on a VPN: without it the tool picks the first
non-internal IPv4, which can be a VPN or Docker address the device cannot reach.

### 5. Prove the server is reachable, before announcing

A positive check beats guessing at firewalls. Fetch one real manifest file over the LAN IP:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "http://<lan-ip>:8787/<name>/$(jq -r '.files[0].path' /tmp/push-story/manifest.json)"
```

`200` means the server, the path, and the interface are all good. Anything else — fix it now;
the device will do exactly this request and has no better luck than curl.

Confirm `<lan-ip>` here is the IP you printed in step 2. **Any network change — switching
between home Wi-Fi and a hotspot, connecting or dropping a VPN — changes the IP and makes a
previously built announce point at an unreachable host.** Always rebuild the announce
(step 6) after any network change.

### 6. Build the announce

```bash
jq -c --arg base "http://<lan-ip>:8787/<name>/" '{channel:"story", type:"story_fetch", bundle:.bundle, base_url:$base, files:.files}' /tmp/push-story/manifest.json > /tmp/push-story/announce.json
```

`base_url` must be `http://` to a private IPv4 address (`10.x`, `172.16`–`172.31.x` or
`192.168.x`), with an optional port and a plain path. The device rejects anything else — `https://`,
a host name, a public or VPN address, a query — with `bad announce: base_url`.

### 7. Announce to each device

One POST per device id. Do **not** fire a second announce at the *same* device while its fetch
is still running (see "In-flight rules").

```bash
curl -sS -X POST $RELAY/devices/$DEVICE/send -H 'Content-Type: application/json' --data @/tmp/push-story/announce.json
```

**Check the relay's own response before you wait on anything.** `Device not connected` (HTTP
503) means the relay holds no live WebSocket for that id, so watching the server log or the
device screen tells you nothing. Against the hosted relay, cause is one of: device powered off,
device never joined WiFi (common after a reflash if the network was down at boot), still
booting, or wrong device id — power-cycle with the network already up, wait for
`[courier] WebSocket connected`, then re-announce.

**An accepted announce returns quietly and immediately.** The relay only forwards it, and the
device's own `story_fetch_done` / `story_fetch_failed` comes back later over the relay, so
step 8 watches the server log to follow progress.

### 8. Watch the server log

```bash
tail -f /tmp/push-story/serve.log
```

One JSON line per request: `{"path":…,"status":…,"bytes":…,"remote":…}`. `remote` attributes
each request, which is how you tell devices apart when several are fetching.

**Your own step-5 probe is in this log too**, as a `200` from the *Mac's* IP — the same shape as
a real fetch. Check `remote` before concluding anything: the Mac's address means you are looking
at your own curl, not the device. Addresses appear IPv4-mapped, e.g. `::ffff:172.20.10.13`.

Success for a device is either:

- every manifest `path` served with status `200` to that device's IP, **or**
- a single `/<name>/.already` hit with status `204` and `bytes: 0` — the device already has
  this exact bundle (matching sizes and CRC32s) and transferred nothing.

The device also replies over the relay: `story_fetch_done` (with `already` and `bytes`) or
`story_fetch_failed` (with `reason`).

**No new log lines for 60 seconds → re-announce** (step 7 again). Safe: a re-announce of the
same bundle either restarts the fetch from scratch or short-circuits to `.already`.
Give up at 5 minutes and go to the troubleshooting table.

### 9. Push the app

Independent of the fetch — a failed app push never means redoing the audio. Repeat per
device id. `/resident:push-app` is a Claude Code skill
invocation, not a shell command, so neither `$DEVICE` nor `$RELAY` will expand here —
substitute `<device-id>` and `<relay-url>` by hand with the same values `DEVICE` and `RELAY`
are exported as above:

```bash
/resident:push-app --device-id <device-id> --base-url <relay-url> device-apps/improv/build/<name>.device.lua
```

push-app defaults to `https://resident.inanimate.tech`, so `--base-url` may be dropped; passing
it explicitly is equivalent.

A committed fetch stays on the device, so if the app push fails you retry **only** this step. Never re-run the audio fetch to recover an app push.

**A zero exit code here means the relay accepted the message, not that the device applied it.**
Confirm on the device — the story should start playing. The app still travels over the relay as
one JSON message (only the *audio* was moved onto the LAN), and Courier parses it into a heap
document on arrival, so a large app can be dropped device-side after a clean push:

    [courier] ws: dropping non-JSON payload (71368 bytes): NoMemory

Observed on hardware, historically: a 50,035-byte app pushed and ran; a 68,748-byte one was
dropped. That ceiling is history now — apps no longer carry actor art (it moved resident into
firmware; see decision 7 in `DESIGN-DECISIONS.md`) and build to
~17 KB, well clear of the old free-heap-dependent limit. An app anywhere near the old ~64 KB
range was built with stale tooling, not a heap problem — rebuild it with a current
`npm run build:app -- --bundle <bundle>` rather than chasing free heap. The
50,035/68,748 numbers above stay documented as context for anyone who meets the `NoMemory`
symptom again.

### 10. Stop the server and report

Stop it by port, not by PID, and wait for the socket to actually close:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN -t | xargs kill
for _ in $(seq 20); do
  lsof -nP -iTCP:8787 -sTCP:LISTEN -t >/dev/null || break
  sleep 0.5
done
lsof -nP -iTCP:8787 -sTCP:LISTEN -t >/dev/null && echo "port 8787 still held" || echo "port 8787 free"
```

Do not stop it with `kill "$(cat .../serve.pid)"`. That kills npm, which is two levels above
the listener (see step 4), and it reports success the instant the signal is sent. Killing the
listener directly is what frees the port; `tsx` and npm then exit on their own, so nothing is
left behind.

The wait loop is the part that makes this reliable. `kill` returns before the kernel has torn
the socket down — measured on this Mac, `lsof` still names the listener immediately after the
signal and only goes quiet a second or two later. Without the loop the step prints its success
line over a port that is still bound, and a push started right behind it fails to bind and
announces the *old* bundle. Trust the final line, not the `kill`.

Report per device: bytes fetched (or `already`), and the app push result.

Leaving the server running is not dangerous — it serves only this bundle's WAVs on the LAN and
exits on its own `--timeout` — but a stale process keeps port 8787 bound, so the next run's
server fails to start and its announce points at the *old* bundle. A start that fails with
`EADDRINUSE` means a previous run's listener is still up: run the block above to clear it, then
retry step 4.

Two details worth knowing: `-sTCP:LISTEN` restricts the match to the listening server, so an
in-flight device connection on the same port is never a kill target; and `xargs` runs nothing
at all on empty input, so the block is safe to run when the server is already gone (it just
prints `port 8787 free`). If it prints `port 8787 still held`, something outside this skill
owns the port — `lsof -nP -iTCP:8787 -sTCP:LISTEN` names it.

## Reading the device screen

The whole point of this skill is diagnosing without a serial cable, and the device narrates
itself on its own display:

| Screen text | Meaning |
| --- | --- |
| `Fetching <bundle>` / `N/M  P%` | Announce received, pulling file N of M |
| `Story ready` / `<bundle>` | Fetch committed successfully |
| `Story fetch failed` / `<reason>` | Failed; the reason string is the same one sent as `story_fetch_failed` |
| `<story title>` / `Press to play` | Cold boot restored the last story from LittleFS; it waits for a button press. No network was needed |
| Identity screen after a power-cycle with the front button held | The boot restore was deliberately skipped, so the device ID is readable. **This skips one boot, it does not forget the story** — away from known WiFi the screen rests, but once the device connects it arms the usual 20-second countdown and loads the story anyway. A **long press during that countdown** forgets the story permanently |
| (unchanged, no fetch text) | The announce never reached `StorySync::onStoryFetch`. It may never have arrived, or it arrived and Resident dropped it before dispatch. **The screen cannot tell those apart** — see "Reading the device over serial" |

That last row is the key fork: screen unchanged means a **control-channel** problem (relay,
device id, device offline, or a channel this firmware does not handle). Screen says `Fetching`
but the server log stays empty means a **data-channel** problem (the device reaches the cloud
but not this Mac).

**Do not read "screen unchanged" as "the device never got it."** A live socket and an HTTP 200
from the relay say the relay accepted the frame, not that the firmware dispatched it. The
device can receive an announce, drop it for an unhandled channel, and narrate nothing at all —
relay, screen and server log are then *all* silent, and no amount of re-announcing changes
that. Serial is the only place that failure is visible. Reason from what you have actually
observed: the branches inside `onStoryFetch` cannot tell you `onStoryFetch` was ever called.

While fetching, the device suspends any running app and resumes it afterwards
(`StorySync::startJob` → `_sandbox->suspendApp()`).

## Reading the device over serial

The screen is the first diagnostic, not the last one. When an announce produces **silence
everywhere** — relay returns 200, screen unchanged, server log empty — the screen has told you
everything it can, and one bounded serial read settles what hours of re-announcing will not.

Plug the device into this Mac. It enumerates as `/dev/cu.usbmodem*` (the port is created by the
running firmware, so a crashed or sleeping device presents nothing at all — that absence is
itself a finding). Nothing may hold the port: quit any serial monitor first, and note that
`pio run -t upload` needs it free too.

`timeout`/`gtimeout` do not exist on this machine, so bound the read in Python. PlatformIO
ships one with pyserial:

```bash
cat > /tmp/push-story/cap.py <<'PY'
import sys, time, serial
port, secs = sys.argv[1], float(sys.argv[2])
s = serial.Serial(port, 115200, timeout=0.2)
end = time.time() + secs
while time.time() < end:
    d = s.read(4096)
    if d:
        sys.stdout.write(d.decode('utf-8', 'replace'))
        sys.stdout.flush()
s.close()
PY
```

Start the capture, then announce into it — the capture has to be running *before* the POST:

```bash
/usr/local/Cellar/platformio/6.1.19_2/libexec/bin/python /tmp/push-story/cap.py /dev/cu.usbmodem14201 30 > /tmp/push-story/serial.log 2>&1 &
sleep 3 && curl -sS -X POST $RELAY/devices/$DEVICE/send -H 'Content-Type: application/json' --data @/tmp/push-story/announce.json
```

What the first line of `serial.log` tells you:

| Serial line | Meaning | Fix |
| --- | --- | --- |
| `no handler for channel 'story' (type 'story_fetch'); dropped` | The frame arrived and Resident dropped it: this firmware predates `main.cpp`'s `onMessageWithChannel("story", ...)` | Reflash with current firmware. Stopgap: `jq -c 'del(.channel)'` on the announce (see below) |
| `[deprecated] un-channelled 'story_fetch' message` | Arrived and dispatched via the legacy path — working, but on borrowed time | Reflash; the legacy path closes once the relay speaks `hello` |
| `[story_sync] done <bundle> already=1 bytes=0` | Arrived, and the device already holds the bundle byte-for-byte | Nothing is wrong |
| `[story_sync] sentinel unreachable: <ip>:<port>` | Already-have path ran, but the device cannot reach this Mac's server | Fix the LAN path before pushing a *changed* bundle |
| `[story_sync] FAILED <bundle>: <reason>` | Arrived, parsed, rejected | Read the reason; see Troubleshooting |
| `[story_sync] retry n/3 <file>: connect failed` | Arrived and fetching, but cannot reach this Mac | Data-channel — stale IP, wrong `--host`, different network |
| (nothing at all) | The frame never reached the firmware | Control-channel — wrong device id, or the relay holds a stale socket |

### The `del(.channel)` stopgap

Firmware that predates the `story` channel handler still registers the legacy un-channelled
path, so stripping the field gets a story onto it today:

```bash
jq -c 'del(.channel)' /tmp/push-story/announce.json > /tmp/push-story/announce-legacy.json
```

Announce that file instead. **This is a stopgap, not a fix.** `main.cpp` closes the legacy path
the day the relay sends `channel:"system" type:"hello"` — `_hostHelloSeen` then drops
un-channelled frames outright, and pushes to that device break with no diagnostic anywhere.
Reflash the device; then use the normal channelled announce and confirm with the `.already`
204 or a full set of `200`s.

## In-flight rules

- **Multiple devices in one run: fine.** Separate devices, separate jobs, one shared server.
- **Same device, same bundle, re-announce: safe.** Idempotent — it restarts the fetch from
  scratch (or replies `already=1 bytes=0` if the bundle is already committed).
- **Same device, a *different* bundle while a fetch is in flight: rejected** with
  `story_fetch_failed` reason `busy`. Wait for that device's job to end (`story_fetch_done`,
  `story_fetch_failed`, or its screen leaving `Fetching`), then announce again.
- Per file the device tries **4 times total** (initial attempt + 3 retries, 0.5s/1s/1.5s
  backoff) with a 10s HTTP timeout, then fails the whole job.

## Multiple devices

One server serves every device — start it once, announce per id.

1. Run steps 1–6 once.
2. Run step 7 once per device id — re-export `DEVICE` to each id in turn, then re-announce.
3. In the log, confirm **each device's own IP** appears in `remote` and reaches either a full
   set of `200`s or one `.already` `204`. A completed set from one IP says nothing about the
   other device.
4. Run step 9 once per device id.

If one device fails and another succeeds, re-announce only to the failed id.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `unexpected argument "fixtures/…"` | Bundle passed positionally | Use `--bundle fixtures/<name>` |
| `SyntaxError: Unexpected end of JSON input`, or jq chokes on `>` | npm's `> serve:bundle` preamble captured into the manifest file | Re-run step 3 with `npm run --silent` |
| Device serial `retry n/3 <file>: connect failed`, 3 retries, then `story_fetch_failed` with `connect failed: <file>` | `base_url` host unreachable — stale IP after a network/VPN change, wrong `--host`, or device on another network. **Looks exactly like a firewall problem and usually is not.** | Re-check `ipconfig getifaddr en0`, re-run the step 5 curl, rebuild the announce (step 6), re-announce |
| Worked earlier in the session, now every announce fails the same way | Server hit its default 600s timeout and exited | Restart it with `--timeout 3600` |
| Announce sent to yesterday's port fails | Default `--port 0` picks a new random port each run | Pin `--port 8787` |
| Step 4 fails with `EADDRINUSE`, or the device fetches the *previous* bundle | A prior run's listener still holds 8787 — it was stopped via npm's PID (which is not the listener), or the port was reused before the socket finished closing | Run step 10's stop block, which kills the listener and waits for the port to actually free, then retry step 4 |
| The announce POST replies `Device not connected` (503) | No live WebSocket for that id: device off, not on Wi-Fi (common after a reflash if the network was down at boot), still booting, or wrong id. Nothing reached the device, so the server log and screen are silent for a reason | Power-cycle with the network already up, wait for `[courier] WebSocket connected`, re-announce |
| Screen never leaves idle, but the announce POST returned quietly | The relay delivered it and the device did not act — firmware predates StorySync, or the message type is unhandled | Confirm the device runs part-3-or-later firmware |
| **Announce accepted (HTTP 200, live socket), screen unchanged, server log empty — and re-announcing changes nothing** | The firmware has no handler for the announce's `channel`, so Resident drops the frame before dispatch. Serial says `no handler for channel 'story' (type 'story_fetch'); dropped`. This device receives the frame and discards it, so **every other vantage point is silent by design** — the relay, the screen and the server log all look exactly like an offline device | Capture serial to confirm (see "Reading the device over serial"), then reflash with current firmware. To land a story right now without reflashing, strip the field: `jq -c 'del(.channel)'` |
| Story plays but is **silent**; serial shows `[audio] missing file /stories/<bundle>/<clip>.wav` | The clips are not on the device. Either the fetch never ran (see the row above — the commonest cause) or a manifest outlived its audio | Push again and watch for a full set of `200`s. Firmware from 2026-09-10 on re-fetches automatically when a listed clip is missing or truncated, instead of answering `already` |
| Screen shows `Fetching`, server log has **zero** lines from that device's IP | Device reaches the cloud relay but not this Mac: different network, guest-Wi-Fi client isolation, or 5 GHz-only AP/hotspot | Put both on the same 2.4 GHz-capable network; on an iPhone hotspot enable "Maximize Compatibility" |
| `story_fetch_failed` reason `busy` | A *different* bundle is mid-fetch on that device | Wait for the in-flight job to end, then re-announce |
| `no space: need N, free M, nothing to evict` with **`free 0`** | LittleFS partition not mounted (typical after `pio run -t erase`). **Not** a disk-full condition | See below |
| `no space: …, nothing to evict` with `free > 0` | Genuinely full and the only stored story is this one | Shorten the bundle's audio, or delete stories via a serial session |
| `crc32 mismatch` / `size mismatch` retried to failure | Manifest captured before the bundle's audio changed | Re-run steps 1 and 3, rebuild the announce, re-announce |
| `404` lines in the server log | Bundle name or file path in the announce does not match what the server serves | Regenerate the manifest from the same bundle dir the server was started with |
| `bad announce: base_url` | `base_url` is not `http://` to a private IPv4 address (a host name, `https://`, a VPN or public address), or over the device's length limit | Use the exact `http://…` line from `serve.log`; if it shows a VPN address, pass `--host` with the Mac's LAN address |
| App push exits 0 but the story never starts; serial shows `dropping non-JSON payload (N bytes): NoMemory` | The app is too large for Courier to parse into a heap document on arrival. Historically this meant actor art was still inlined in the app. The relay accepted it, the device discarded it. Audio delivery is unaffected — that story's files are already committed | Rebuild with a current `npm run build:app -- --bundle <bundle>` (apps should be ~17 KB now that art is resident in firmware, not 50–70 KB). If a freshly built app is still this large, reboot for maximum free heap and retry |
| Device screen shows `Art set mismatch.` after a successful push | The app was built against a different troupe-art fingerprint than the one baked into the device's current firmware | Reflash the device with current firmware, or rebuild the app against the art set the firmware actually has, so both fingerprints match |
| Device drops off WiFi and serial shows `*wm:StartAP with SSID: Resident … <id>` | WiFi auto-connect failed, so Courier fell back to its config portal. The device is now its own AP at `192.168.4.1` and is off the relay entirely — announces will return `Device not connected` | Join the device's `Resident … <id>` network, open `http://192.168.4.1`, re-enter WiFi credentials; or bring the original network back up and reboot |
| Device rebooted and came back on the identity screen with no story | Nothing has been pushed since the last `pio run -t uploadfs` (which wipes LittleFS), the front button was held through power-on, or the stored `/app.lua` failed to load and the device forgot it (serial: `saved app failed to load; forgetting it`) | Push a story again; it persists from then on |

### `no space … nothing to evict` with `free 0`

`free 0` means LittleFS never mounted — there is no filesystem to write into, which the space
check reports as zero free bytes. This is the expected state after `pio run -t erase`. Fix it
by uploading a filesystem image once (this is the one step that needs USB):

```bash
mkdir -p device/data && cd device && pio run -t uploadfs
```

Then re-announce. No audio needs to be staged in `device/data` for this — an empty image is
enough to give StorySync a mounted filesystem.

## Worked example

Push `fixtures/a-dog-called-bear` to the device `<device-id>`, Mac at `192.168.1.42`:

```bash
npm run validate -- fixtures/a-dog-called-bear/performance.json --check-files
```

```bash
npm run build:app -- --bundle fixtures/a-dog-called-bear
```

```bash
ipconfig getifaddr en0
```

→ `192.168.1.42`

```bash
mkdir -p /tmp/push-story && npm run --silent serve:bundle -- --bundle fixtures/a-dog-called-bear --manifest > /tmp/push-story/manifest.json
```

```bash
npm run serve:bundle -- --bundle fixtures/a-dog-called-bear --port 8787 --host 192.168.1.42 --timeout 3600 > /tmp/push-story/serve.log 2>&1 &
```

```bash
for _ in $(seq 60); do
  grep -m1 '^serving ' /tmp/push-story/serve.log && break
  sleep 0.5
done
grep -q '^serving ' /tmp/push-story/serve.log || { echo "serve:bundle never came up:"; cat /tmp/push-story/serve.log; }
```

→ `serving http://192.168.1.42:8787/a-dog-called-bear/`

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "http://192.168.1.42:8787/a-dog-called-bear/$(jq -r '.files[0].path' /tmp/push-story/manifest.json)"
```

→ `200`

```bash
jq -c --arg base "http://192.168.1.42:8787/a-dog-called-bear/" '{channel:"story", type:"story_fetch", bundle:.bundle, base_url:$base, files:.files}' /tmp/push-story/manifest.json > /tmp/push-story/announce.json
```

```bash
curl -sS -X POST $RELAY/devices/$DEVICE/send -H 'Content-Type: application/json' --data @/tmp/push-story/announce.json
```

```bash
tail -f /tmp/push-story/serve.log
```

→ device screen shows `Fetching a-dog-called-bear 3/17 27%`, log fills with
`{"path":"/a-dog-called-bear/aud_000.wav","status":200,"bytes":129026,"remote":"192.168.1.57"}`
until all 17 manifest paths are served (~1.7 MB, roughly 20s at the ~95 KB/s measured on
hardware); device shows `Story ready a-dog-called-bear` and replies `story_fetch_done`.

```bash
/resident:push-app --device-id <device-id> --base-url <relay-url> device-apps/improv/build/a-dog-called-bear.device.lua
```

→ `<relay-url>` is `https://resident.inanimate.tech` and `<device-id>` is the id from the
identity screen.

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN -t | xargs kill
for _ in $(seq 20); do
  lsof -nP -iTCP:8787 -sTCP:LISTEN -t >/dev/null || break
  sleep 0.5
done
lsof -nP -iTCP:8787 -sTCP:LISTEN -t >/dev/null && echo "port 8787 still held" || echo "port 8787 free"
```

→ `port 8787 free`

A second run of the same bundle logs one line —
`{"path":"/a-dog-called-bear/.already","status":204,"bytes":0,"remote":"192.168.1.57"}` —
and finishes in seconds with `already=1 bytes=0`.
