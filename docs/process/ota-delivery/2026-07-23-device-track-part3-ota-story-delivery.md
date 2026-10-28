# Device Track Part 3 — OTA Story Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove USB from the story loop — the device fetches a bundle's audio over LAN HTTP when a `story_fetch` announce arrives on its existing Resident/Courier WebSocket, and a `push-story` skill drives the whole delivery.

**Architecture:** A `StorySync` firmware extension (no Lua surface) handles the announce: pulls each manifest file into `/stories/<bundle>.tmp/`, verifies size + CRC32, renames over `/stories/<bundle>/` (the exact paths `AudioDriver` reads), evicting old stories when space is short. `tools/serve-bundle.ts` generates the manifest and serves the bundle ephemerally; the `push-story` skill orchestrates serve → announce → watch log → `push-app`. The existing `story-director` skill's device run loop delegates to `push-story`.

**Tech Stack:** TypeScript (Node ≥20, ESM, tsx, vitest 3) for tools/tests; C++17 Arduino (PlatformIO `espressif32@6.12`, env `m5sticks3`) for firmware; ArduinoJson, HTTPClient, LittleFS, `esp_rom_crc.h` on-device.

**Spec:** `docs/superpowers/specs/2026-07-20-device-track-part3-courier-story-delivery-design.md`

## Global Constraints

- Repo root: `<repo root>`. All `npm` commands run there; all `pio` commands run in `device/`.
- Node ≥20, `"type": "module"`. Tests: `npm test` (vitest run). Types: `npm run typecheck`. Both must pass before every commit that touches TS.
- Firmware compiles with `cd device && pio run` (env `m5sticks3`, `-std=gnu++17`). Flashing (`pio run -t upload`) needs the StickS3 on USB **and the user present** — flash steps are marked ⚠️ HARDWARE.
- CRC32 = IEEE 802.3 / zlib polynomial `0xEDB88320`, transmitted as **8 lowercase hex chars**. On-device: `esp_rom_crc32_le(crc, buf, len)` chained from `0` (verify equivalence at the M0 checkpoint).
- Protocol message types, verbatim: `story_fetch`, `story_fetch_done`, `story_fetch_failed`.
- Device filesystem layout, verbatim: `/stories/<bundle>/<flat-name>.wav`, tmp dir `/stories/<bundle>.tmp/`, per-bundle receipt `/stories/<bundle>/.manifest.json`, fetch-order index `/stories/.index`. Manifest `path` values are **flat basenames** (no slashes) — `AudioDriver` prepends the leading `/` itself.
- Relay: `POST https://resident.inanimate.tech/devices/<id>/send` with the JSON message as the body. Default device id `<device-id>`. Serial monitor: 115200 baud.
- Data partition `0x460000` bytes (`device/partitions.csv`, label `littlefs`).
- Every commit message ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: CRC32 library (`tools/lib/crc32.ts`)

**Files:**
- Create: `tools/lib/crc32.ts`
- Test: `tests/crc32.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `crc32(data: Uint8Array): number` (unsigned 32-bit) and `crc32Hex(data: Uint8Array): string` (8 lowercase hex chars). Task 3 uses `crc32Hex` for manifest entries.

- [ ] **Step 1: Write the failing test**

```ts
// tests/crc32.test.ts
import { describe, it, expect } from "vitest";
import { crc32, crc32Hex } from "../tools/lib/crc32";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the standard check value for '123456789'", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("matches zlib for a longer ASCII string", () => {
    // python3 -c "import zlib; print(hex(zlib.crc32(b'The quick brown fox jumps over the lazy dog')))"
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("crc32Hex pads to 8 lowercase hex chars", () => {
    expect(crc32Hex(bytes("123456789"))).toBe("cbf43926");
    expect(crc32Hex(new Uint8Array(0))).toBe("00000000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/crc32.test.ts`
Expected: FAIL — `Cannot find module '../tools/lib/crc32'`

- [ ] **Step 3: Write the implementation**

```ts
// tools/lib/crc32.ts — CRC-32 (IEEE 802.3, the zlib/PNG polynomial), table-based.
// The device computes the same function via esp_rom_crc32_le.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** crc32 as 8 lowercase hex chars — the wire format in story_fetch manifests. */
export function crc32Hex(data: Uint8Array): string {
  return crc32(data).toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/crc32.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Full gate + commit**

```bash
npm run typecheck && npm test
git add tools/lib/crc32.ts tests/crc32.test.ts
git commit -m "feat: crc32 lib — IEEE/zlib polynomial, wire-format hex

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract the shared staging-set helper (`tools/lib/staging.ts`)

The spec requires `pack:audio` and `serve-bundle` to derive the staged file set from one helper so they cannot drift.

**Files:**
- Create: `tools/lib/staging.ts`
- Modify: `tools/pack-audio.ts`
- Test: `tests/staging.test.ts` (new); `tests/pack-audio.test.ts` must stay green unchanged

**Interfaces:**
- Consumes: `loadBundle(dir)` from `tools/lib/bundle.ts` (returns `{ dir, name, perf, ... }`; `perf.assets.audio` is `{ id, uri, ... }[]`).
- Produces: `stagedAudioFiles(bundle: Bundle): { src: string; base: string }[]` — every `assets.audio` entry sorted by `id`; `src` absolute-ish path on disk, `base` the flat filename staged on-device. Tasks 3–4 build manifests and the server allowlist from it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/staging.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadBundle } from "../tools/lib/bundle";
import { stagedAudioFiles } from "../tools/lib/staging";

const KNIGHT = "fixtures/knight-and-lonely-dragon";

describe("stagedAudioFiles", () => {
  it("lists every assets.audio entry, sorted by id, with flat basenames", () => {
    const bundle = loadBundle(KNIGHT);
    const files = stagedAudioFiles(bundle);
    expect(files).toHaveLength(bundle.perf.assets.audio.length);
    const ids = [...bundle.perf.assets.audio].sort((x, y) => x.id.localeCompare(y.id));
    files.forEach((f, i) => {
      expect(f.base).toBe(path.basename(ids[i].uri));
      expect(f.base).not.toContain("/");
      expect(f.src).toBe(path.join(bundle.dir, ids[i].uri));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/staging.test.ts`
Expected: FAIL — `Cannot find module '../tools/lib/staging'`

- [ ] **Step 3: Write the helper**

```ts
// tools/lib/staging.ts — the staged-audio file set shared by pack:audio and
// serve:bundle, so the USB image and the OTA manifest can never drift.
import path from "node:path";
import type { Bundle } from "./bundle";

export interface StagedFile {
  src: string;  // the rendered WAV on disk
  base: string; // its flat name under stories/<bundle>/ on-device
}

/** Every assets.audio entry, sorted by id. */
export function stagedAudioFiles(bundle: Bundle): StagedFile[] {
  return [...bundle.perf.assets.audio]
    .sort((x, y) => x.id.localeCompare(y.id))
    .map((a) => ({ src: path.join(bundle.dir, a.uri), base: path.basename(a.uri) }));
}
```

- [ ] **Step 4: Refactor `pack-audio.ts` to use it**

In `tools/pack-audio.ts`, add the import and replace the inner staging loop. The `for (const a of ...)` loop body inside `packAudio` currently reads:

```ts
    for (const a of [...bundle.perf.assets.audio].sort((x, y) => x.id.localeCompare(y.id))) {
      const src = path.join(bundle.dir, a.uri);
      staged.push({ bundleName: bundle.name, src, base: path.basename(a.uri) });
      bytes += statSync(src).size;
    }
```

Replace with:

```ts
    for (const { src, base } of stagedAudioFiles(bundle)) {
      staged.push({ bundleName: bundle.name, src, base });
      bytes += statSync(src).size;
    }
```

and add to the imports at the top:

```ts
import { stagedAudioFiles } from "./lib/staging";
```

- [ ] **Step 5: Run the full suite to verify no behavior change**

Run: `npm run typecheck && npm test`
Expected: PASS, including the untouched `tests/pack-audio.test.ts` (19 files staged for the knight bundle).

- [ ] **Step 6: Commit**

```bash
git add tools/lib/staging.ts tools/pack-audio.ts tests/staging.test.ts
git commit -m "refactor: extract shared staged-audio file set from pack:audio

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `serve-bundle` manifest mode

**Files:**
- Create: `tools/serve-bundle.ts`
- Test: `tests/serve-bundle.test.ts`

**Interfaces:**
- Consumes: `stagedAudioFiles` (Task 2), `crc32Hex` (Task 1), `loadBundle`/`loadTroupe`/`validatePerformance` (existing, signatures as used in `tools/pack-audio.ts`).
- Produces: `buildManifest(bundleDir: string): BundleManifest` where `BundleManifest = { bundle: string; files: { path: string; size: number; crc32: string }[] }`. Task 4 reuses it for the server allowlist; Task 9's skill embeds its output in the announce.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/serve-bundle.test.ts
import { describe, it, expect } from "vitest";
import { statSync } from "node:fs";
import { buildManifest } from "../tools/serve-bundle";
import { loadBundle } from "../tools/lib/bundle";
import { stagedAudioFiles } from "../tools/lib/staging";

const KNIGHT = "fixtures/knight-and-lonely-dragon";

describe("buildManifest", () => {
  it("covers exactly the staged file set with real sizes and 8-hex crcs", () => {
    const manifest = buildManifest(KNIGHT);
    expect(manifest.bundle).toBe("knight-and-lonely-dragon");
    const staged = stagedAudioFiles(loadBundle(KNIGHT));
    expect(manifest.files.map((f) => f.path)).toEqual(staged.map((s) => s.base));
    for (const [i, f] of manifest.files.entries()) {
      expect(f.size).toBe(statSync(staged[i].src).size);
      expect(f.crc32).toMatch(/^[0-9a-f]{8}$/);
      expect(f.path.endsWith(".wav")).toBe(true);
    }
  });

  it("refuses a bundle whose audio is missing on disk", () => {
    // Same broken-bundle pattern as tests/pack-audio.test.ts: copy the knight
    // bundle to a temp dir and delete one referenced WAV.
    const bundleDir = mkdtempSync(path.join(tmpdir(), "manifest-bundle-"));
    cpSync(KNIGHT, bundleDir, { recursive: true });
    rmSync(path.join(bundleDir, "audio/aud_000.wav"));
    expect(() => buildManifest(bundleDir)).toThrow();
  });
});
```

with the extra imports at the top of the file:

```ts
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
```

(merge the `node:fs` names into the existing `statSync` import line).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serve-bundle.test.ts`
Expected: FAIL — `Cannot find module '../tools/serve-bundle'`

- [ ] **Step 3: Write manifest mode**

```ts
// tools/serve-bundle.ts — OTA story delivery, Mac side: the story_fetch
// manifest (--manifest) and the ephemeral HTTP server (default) that the
// device pulls a bundle's audio from. See the part 3 spec for the protocol.
import { readFileSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadBundle } from "./lib/bundle";
import { loadTroupe } from "./lib/troupe";
import { validatePerformance } from "./lib/validator";
import { stagedAudioFiles } from "./lib/staging";
import { crc32Hex } from "./lib/crc32";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
void ROOT; // (kept for symmetry with sibling tools; bundle dirs arrive as args)

export interface ManifestFile { path: string; size: number; crc32: string; }
export interface BundleManifest { bundle: string; files: ManifestFile[]; }

/** Validate the bundle (with --check-files strictness), then describe its
 *  staged audio set the way the story_fetch announce carries it. */
export function buildManifest(bundleDir: string): BundleManifest {
  const bundle = loadBundle(bundleDir);
  const troupe = loadTroupe();
  const result = validatePerformance(bundle.perf, troupe, { checkFilesDir: bundle.dir });
  if (!result.ok) {
    const detail = result.errors.map((e) => `  ${e.path} ${e.message}`).join("\n");
    throw new Error(`${bundle.name} failed validation:\n${detail}`);
  }
  const files = stagedAudioFiles(bundle).map(({ src, base }) => ({
    path: base,
    size: statSync(src).size,
    crc32: crc32Hex(readFileSync(src)),
  }));
  return { bundle: bundle.name, files };
}
```

(The server half and the CLI arrive in Task 4 — this file compiles and exports `buildManifest` now.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serve-bundle.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Full gate + commit**

```bash
npm run typecheck && npm test
git add tools/serve-bundle.ts tests/serve-bundle.test.ts
git commit -m "feat: serve-bundle manifest mode — the story_fetch file list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `serve-bundle` server mode + CLI

**Files:**
- Modify: `tools/serve-bundle.ts` (append server + CLI)
- Modify: `package.json` (add `serve:bundle` script)
- Test: `tests/serve-bundle.test.ts` (append server tests)

**Interfaces:**
- Consumes: `buildManifest` (Task 3), `stagedAudioFiles` (Task 2).
- Produces: `createBundleServer(bundleDir: string, opts?: { port?: number; host?: string; log?: (line: string) => void }): Promise<{ port: number; baseUrl: string; close(): Promise<void> }>`. Log lines are single-line JSON: `{"path": "/<bundle>/<file>", "status": 200|204|404|405, "bytes": n, "remote": "<ip>"}`. Sentinel route `GET /<bundle>/.already` → 204. Task 9's skill starts the CLI and tails these lines.

- [ ] **Step 1: Append the failing server tests**

Append to `tests/serve-bundle.test.ts`:

```ts
import { createBundleServer } from "../tools/serve-bundle";

describe("createBundleServer", () => {
  async function withServer(fn: (srv: Awaited<ReturnType<typeof createBundleServer>>, logs: string[]) => Promise<void>) {
    const logs: string[] = [];
    const srv = await createBundleServer(KNIGHT, { host: "127.0.0.1", log: (l) => logs.push(l) });
    try { await fn(srv, logs); } finally { await srv.close(); }
  }

  it("serves a manifest file with correct bytes and logs the request", () =>
    withServer(async (srv, logs) => {
      const manifest = buildManifest(KNIGHT);
      const first = manifest.files[0];
      const res = await fetch(`${srv.baseUrl}${first.path}`);
      expect(res.status).toBe(200);
      const body = new Uint8Array(await res.arrayBuffer());
      expect(body.length).toBe(first.size);
      const entry = JSON.parse(logs.at(-1)!);
      expect(entry).toMatchObject({ path: `/knight-and-lonely-dragon/${first.path}`, status: 200, bytes: first.size });
      expect(entry.remote).toBeTruthy();
    }));

  it("404s anything outside the manifest", () =>
    withServer(async (srv, logs) => {
      const res = await fetch(`${srv.baseUrl}../performance.json`);
      expect(res.status).toBe(404);
      expect(JSON.parse(logs.at(-1)!).status).toBe(404);
    }));

  it("answers the .already sentinel with 204 and logs it", () =>
    withServer(async (srv, logs) => {
      const res = await fetch(`${srv.baseUrl}.already`);
      expect(res.status).toBe(204);
      expect(JSON.parse(logs.at(-1)!)).toMatchObject({ status: 204, bytes: 0 });
    }));

  it("rejects non-GET methods with 405", () =>
    withServer(async (srv) => {
      const manifest = buildManifest(KNIGHT);
      const res = await fetch(`${srv.baseUrl}${manifest.files[0].path}`, { method: "POST" });
      expect(res.status).toBe(405);
    }));

  it("baseUrl uses the requested host and ends with /<bundle>/", () =>
    withServer(async (srv) => {
      expect(srv.baseUrl).toBe(`http://127.0.0.1:${srv.port}/knight-and-lonely-dragon/`);
    }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serve-bundle.test.ts`
Expected: FAIL — `createBundleServer` is not exported

- [ ] **Step 3: Append the server + CLI to `tools/serve-bundle.ts`**

```ts
/** First non-internal IPv4 — the base_url host the device can reach on the LAN. */
export function lanHost(): string {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return "127.0.0.1";
}

export interface ServeOptions {
  port?: number;                 // default 0 = random high port
  host?: string;                 // default lanHost(); tests pass 127.0.0.1
  log?: (line: string) => void;  // default console.log; one JSON line per request
}
export interface BundleServer { port: number; baseUrl: string; close(): Promise<void>; }

export async function createBundleServer(bundleDir: string, opts: ServeOptions = {}): Promise<BundleServer> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const bundle = loadBundle(bundleDir);
  buildManifest(bundleDir); // validation gate — refuse to serve a broken bundle
  const allow = new Map<string, string>(); // url path -> file on disk
  for (const { src, base } of stagedAudioFiles(bundle)) allow.set(`/${bundle.name}/${base}`, src);
  const sentinel = `/${bundle.name}/.already`;

  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    const remote = req.socket.remoteAddress ?? "?";
    const reply = (status: number, bytes: number, body?: Buffer) => {
      res.writeHead(status, body ? { "content-type": "audio/wav", "content-length": bytes } : {});
      res.end(body);
      log(JSON.stringify({ path: url, status, bytes, remote }));
    };
    if (req.method !== "GET") return reply(405, 0);
    if (url === sentinel) return reply(204, 0);
    const src = allow.get(url);
    if (!src) return reply(404, 0);
    const body = readFileSync(src);
    reply(200, body.length, body);
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, resolve));
  const port = (server.address() as { port: number }).port;
  const host = opts.host ?? lanHost();
  return {
    port,
    baseUrl: `http://${host}:${port}/${bundle.name}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  let dir: string | undefined, manifestMode = false, host: string | undefined;
  let port = 0, timeoutS = 600;
  const usage =
    "usage: serve:bundle -- --bundle <dir> [--manifest] [--port N] [--host IP] [--timeout SECONDS]";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--bundle") dir = argv[++i];
    else if (argv[i] === "--manifest") manifestMode = true;
    else if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--host") host = argv[++i];
    else if (argv[i] === "--timeout") timeoutS = Number(argv[++i]);
    else { console.error(`unknown flag "${argv[i]}"\n${usage}`); process.exit(1); }
  }
  if (!dir || Number.isNaN(port) || Number.isNaN(timeoutS)) { console.error(usage); process.exit(1); }
  if (manifestMode) {
    console.log(JSON.stringify(buildManifest(dir), null, 2));
  } else {
    const srv = await createBundleServer(dir, { port, host });
    console.log(`serving ${srv.baseUrl}`);
    const stop = async () => { await srv.close(); process.exit(0); };
    const timer = setTimeout(stop, timeoutS * 1000);
    timer.unref();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
}
```

- [ ] **Step 4: Add the npm script**

In `package.json` scripts, after `"pack:audio"`:

```json
    "serve:bundle": "tsx tools/serve-bundle.ts",
```

- [ ] **Step 5: Run tests + a manual CLI smoke**

Run: `npm run typecheck && npm test`
Expected: PASS.

Run: `npm run serve:bundle -- --bundle fixtures/knight-and-lonely-dragon --manifest | head -8`
Expected: JSON with `"bundle": "knight-and-lonely-dragon"` and 19 `files` entries.

- [ ] **Step 6: Commit**

```bash
git add tools/serve-bundle.ts tests/serve-bundle.test.ts package.json
git commit -m "feat: serve-bundle server mode — ephemeral OTA audio server with JSON request log

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `StorySync` scaffold — announce intake, replies, boot cleanup, wiring

Firmware has no host-side test harness (per spec); the gate for Tasks 5–6 is a clean `pio run` compile, then the Task 7 hardware checkpoint.

**Files:**
- Create: `device/lib/drivers/src/StorySync.h`
- Create: `device/lib/drivers/src/StorySync.cpp`
- Modify: `device/src/main.cpp`

**Interfaces:**
- Consumes: `Resident::Extension` (virtuals `name/begin/update/onAppReset`); `Resident::Sandbox` (`ws().sendText(const char*)`, `isAppRunning()`, `isAppSuspended()`, `suspendApp()`, `resumeApp()`); `DisplayDriver::displayText(const char*)`; Arduino `LittleFS`, `HTTPClient`, ArduinoJson v7.
- Produces: `class StorySync : public Resident::Extension` with `attach(Resident::Sandbox*, DisplayDriver*)` and `onStoryFetch(JsonDocument&)`. Task 6 fills in the four `// Task 6` stubs; their names and signatures are fixed here.

- [ ] **Step 1: Write `StorySync.h`**

```cpp
#ifndef STORY_SYNC_H
#define STORY_SYNC_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <FS.h>
#include <ResidentExtension.h>

class DisplayDriver;
namespace Resident { class Sandbox; }

// Over-the-air story delivery (device track part 3). Handles "story_fetch"
// announces arriving over the sandbox WebSocket: HTTP-pulls each manifest
// file into /stories/<bundle>.tmp/, verifies size + CRC32 per file, then
// renames the directory over /stories/<bundle>/ — the same paths AudioDriver
// reads. Replies story_fetch_done / story_fetch_failed over the WebSocket.
// No Lua surface: by the time an app is pushed, the audio is in place.
class StorySync : public Resident::Extension {
public:
  const char* name() const override { return "story_sync"; }

  // Wire once in setup(), after the sandbox exists.
  void attach(Resident::Sandbox* sandbox, DisplayDriver* display) {
    _sandbox = sandbox;
    _display = display;
  }

  void begin() override;   // deletes leftover /stories/*.tmp from a cut fetch
  void update() override;  // fetch state machine; bounded work per tick

  // Called from main.cpp's sandbox.onMessage for type == "story_fetch".
  void onStoryFetch(JsonDocument& doc);

private:
  static constexpr int      MAX_FILES       = 48;
  static constexpr size_t   NAME_MAX        = 47;        // flat basenames only
  static constexpr size_t   SLICE_BYTES     = 16 * 1024; // per-tick read budget
  static constexpr int      FILE_RETRIES    = 3;
  static constexpr size_t   SPACE_SLACK     = 64 * 1024;
  static constexpr uint32_t HTTP_TIMEOUT_MS = 10000;
  static constexpr uint32_t STREAM_STALL_MS = 10000;

  struct FileEntry { char name[NAME_MAX + 1]; uint32_t size; uint32_t crc32; };
  enum class State { Idle, StartFile, Streaming };

  // ── job setup (this task) ──
  bool parseAnnounce(JsonDocument& doc);  // sanitize into members; replies on error
  bool alreadyHave();                     // /stories/<b>/.manifest.json matches?
  void startJob();                        // suspend app, mk tmp, enter StartFile
  void endJob();                          // resume app, reset to Idle

  // ── fetch engine (Task 6) ──
  bool ensureSpace();                     // evict oldest until the job fits
  void startFile();                       // open HTTP GET + tmp file, or commit
  void streamSlice();                     // ≤ SLICE_BYTES per tick
  void finishFile();                      // verify size + crc, advance
  void retryOrFail(const char* why);
  void commitBundle();                    // write receipt, rename, update index

  // ── plumbing (this task) ──
  void sendDone(bool already);
  void sendFailed(const char* reason);
  void sendFailedFor(const char* bundle, const char* reason);
  void showProgress();
  void abortFile();                       // close http + tmp file handles
  static bool validBundleName(const char* s);
  static bool validFileName(const char* s);
  static void removeDirRecursive(const String& dirPath);

  Resident::Sandbox* _sandbox = nullptr;
  DisplayDriver*     _display = nullptr;

  State     _state = State::Idle;
  char      _bundle[41] = {0};
  char      _baseUrl[160] = {0};
  FileEntry _files[MAX_FILES];
  int       _fileCount = 0;
  int       _fileIndex = 0;
  int       _attempt = 0;
  bool      _suspendedApp = false;
  uint32_t  _jobStartMs = 0;
  uint32_t  _totalBytes = 0;
  uint32_t  _retryAtMs = 0;

  HTTPClient _http;
  WiFiClient _wifi;
  File       _out;
  uint32_t   _crc = 0;
  uint32_t   _received = 0;
  uint32_t   _lastDataMs = 0;
  uint32_t   _lastProgressMs = 0;
};

#endif  // STORY_SYNC_H
```

- [ ] **Step 2: Write `StorySync.cpp` (scaffold half)**

Everything except the four Task-6 bodies, which are compiling stubs for now:

```cpp
#include "StorySync.h"
#include <LittleFS.h>
#include <Resident.h>
#include "DisplayDriver.h"

// ── name validation ─────────────────────────────────────────────────────────
// Bundle dirs are kebab fixture names; manifest paths are flat WAV basenames.
// Rejecting everything else bounds a hostile announce to writing WAVs under
// /stories/ (see the spec's open-relay risk).

bool StorySync::validBundleName(const char* s) {
  size_t n = strlen(s);
  if (n == 0 || n > 40) return false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (!(islower((unsigned char)c) || isdigit((unsigned char)c) || c == '-')) return false;
  }
  return true;
}

bool StorySync::validFileName(const char* s) {
  size_t n = strlen(s);
  if (n < 5 || n > NAME_MAX) return false;               // "x.wav" minimum
  if (s[0] == '.') return false;
  if (strcmp(s + n - 4, ".wav") != 0) return false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (!(isalnum((unsigned char)c) || c == '.' || c == '_' || c == '-')) return false;
  }
  return true;
}

// ── filesystem helpers ──────────────────────────────────────────────────────

// Delete-first iteration: repeatedly open the dir, remove its first entry,
// until empty — sidesteps iterator invalidation while deleting.
void StorySync::removeDirRecursive(const String& dirPath) {
  for (;;) {
    File dir = LittleFS.open(dirPath);
    if (!dir || !dir.isDirectory()) { if (dir) dir.close(); break; }
    File entry = dir.openNextFile();
    if (!entry) { dir.close(); break; }
    String p = entry.path();
    bool isDir = entry.isDirectory();
    entry.close();
    dir.close();
    if (isDir) removeDirRecursive(p);
    else LittleFS.remove(p);
  }
  LittleFS.rmdir(dirPath);
}

void StorySync::begin() {
  File root = LittleFS.open("/stories");
  if (!root) return;
  String stale[8];
  int staleCount = 0;
  for (File e = root.openNextFile(); e && staleCount < 8; e = root.openNextFile()) {
    String p = e.path();
    bool isTmpDir = e.isDirectory() && p.endsWith(".tmp");
    e.close();
    if (isTmpDir) stale[staleCount++] = p;
  }
  root.close();
  for (int i = 0; i < staleCount; i++) {
    Serial.printf("[story_sync] removing stale %s\n", stale[i].c_str());
    removeDirRecursive(stale[i]);
  }
}

// ── replies ─────────────────────────────────────────────────────────────────

void StorySync::sendDone(bool already) {
  JsonDocument doc;
  doc["type"] = "story_fetch_done";
  doc["bundle"] = _bundle;
  doc["already"] = already;
  doc["bytes"] = _totalBytes;
  doc["ms"] = millis() - _jobStartMs;
  String out;
  serializeJson(doc, out);
  if (_sandbox) _sandbox->ws().sendText(out.c_str());
  Serial.printf("[story_sync] done %s already=%d bytes=%u\n", _bundle, already, _totalBytes);
}

void StorySync::sendFailedFor(const char* bundle, const char* reason) {
  JsonDocument doc;
  doc["type"] = "story_fetch_failed";
  doc["bundle"] = bundle;
  doc["reason"] = reason;
  String out;
  serializeJson(doc, out);
  if (_sandbox) _sandbox->ws().sendText(out.c_str());
  Serial.printf("[story_sync] FAILED %s: %s\n", bundle, reason);
  if (_display) {
    char msg[96];
    snprintf(msg, sizeof(msg), "Story fetch failed\n%s", reason);
    _display->displayText(msg);
  }
}

void StorySync::sendFailed(const char* reason) { sendFailedFor(_bundle, reason); }

void StorySync::showProgress() {
  if (!_display) return;
  char msg[96];
  uint32_t pct = _fileIndex >= _fileCount || _files[_fileIndex].size == 0
                     ? 0
                     : (_received * 100u) / _files[_fileIndex].size;
  snprintf(msg, sizeof(msg), "Fetching %s\n%d/%d  %u%%", _bundle,
           _fileIndex + 1, _fileCount, pct);
  _display->displayText(msg);
  _lastProgressMs = millis();
}

// ── announce intake ─────────────────────────────────────────────────────────

bool StorySync::parseAnnounce(JsonDocument& doc) {
  const char* bundle = doc["bundle"] | "";
  const char* baseUrl = doc["base_url"] | "";
  JsonArray files = doc["files"].as<JsonArray>();
  if (!validBundleName(bundle)) { sendFailedFor("?", "bad announce: bundle"); return false; }
  if (strncmp(baseUrl, "http://", 7) != 0 || strlen(baseUrl) > sizeof(_baseUrl) - 2) {
    sendFailedFor(bundle, "bad announce: base_url");
    return false;
  }
  if (files.isNull() || files.size() == 0 || files.size() > (size_t)MAX_FILES) {
    sendFailedFor(bundle, "bad announce: files");
    return false;
  }
  strlcpy(_bundle, bundle, sizeof(_bundle));
  strlcpy(_baseUrl, baseUrl, sizeof(_baseUrl));
  size_t n = strlen(_baseUrl);                 // fetch URLs are base_url + name
  if (_baseUrl[n - 1] != '/') { _baseUrl[n] = '/'; _baseUrl[n + 1] = '\0'; }
  _fileCount = 0;
  for (JsonObject f : files) {
    const char* name = f["path"] | "";
    long long size = f["size"] | -1;
    const char* crcHex = f["crc32"] | "";
    if (!validFileName(name) || size <= 0 || strlen(crcHex) != 8) {
      sendFailed("bad announce: file entry");
      return false;
    }
    FileEntry& e = _files[_fileCount++];
    strlcpy(e.name, name, sizeof(e.name));
    e.size = (uint32_t)size;
    e.crc32 = (uint32_t)strtoul(crcHex, nullptr, 16);
  }
  return true;
}

bool StorySync::alreadyHave() {
  String path = String("/stories/") + _bundle + "/.manifest.json";
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return false;
  JsonArray files = doc["files"].as<JsonArray>();
  if (files.isNull() || (int)files.size() != _fileCount) return false;
  int i = 0;
  for (JsonObject f2 : files) {
    const char* name = f2["path"] | "";
    uint32_t size = f2["size"] | 0;
    uint32_t crc = (uint32_t)strtoul(f2["crc32"] | "0", nullptr, 16);
    FileEntry& e = _files[i++];
    if (strcmp(name, e.name) != 0 || size != e.size || crc != e.crc32) return false;
  }
  return true;
}

// ── job lifecycle ───────────────────────────────────────────────────────────

void StorySync::abortFile() {
  if (_out) _out.close();
  _http.end();
}

void StorySync::startJob() {
  if (_sandbox && _sandbox->isAppRunning() && !_sandbox->isAppSuspended()) {
    _sandbox->suspendApp();
    _suspendedApp = true;
  }
  String tmp = String("/stories/") + _bundle + ".tmp";
  removeDirRecursive(tmp);
  LittleFS.mkdir("/stories");
  LittleFS.mkdir(tmp);
  _fileIndex = 0;
  _attempt = 0;
  _totalBytes = 0;
  _retryAtMs = 0;
  _jobStartMs = millis();
  _state = State::StartFile;
  showProgress();
}

void StorySync::endJob() {
  abortFile();
  if (_suspendedApp && _sandbox) _sandbox->resumeApp();
  _suspendedApp = false;
  _state = State::Idle;
}

void StorySync::onStoryFetch(JsonDocument& doc) {
  const char* incoming = doc["bundle"] | "";
  if (_state != State::Idle) {
    if (strcmp(incoming, _bundle) != 0) {
      sendFailedFor(incoming, "busy");
      return;
    }
    abortFile();  // same bundle re-announced mid-fetch: restart from scratch
    _state = State::Idle;
  }
  if (!parseAnnounce(doc)) return;
  _jobStartMs = millis();
  _totalBytes = 0;
  if (alreadyHave()) {
    // Hit the sentinel so the server log stays the skill's completion oracle.
    String url = String(_baseUrl) + ".already";
    _http.setConnectTimeout(HTTP_TIMEOUT_MS);
    _http.begin(_wifi, url);
    _http.GET();
    _http.end();
    sendDone(true);
    return;
  }
  if (!ensureSpace()) return;  // ensureSpace replies with the byte math
  startJob();
}

void StorySync::update() {
  switch (_state) {
    case State::Idle: return;
    case State::StartFile:
      if (millis() < _retryAtMs) return;
      startFile();
      return;
    case State::Streaming:
      streamSlice();
      return;
  }
}

// ── Task 6 stubs (compile-only; replaced by the fetch engine) ───────────────

bool StorySync::ensureSpace() { sendFailed("fetch engine not built"); return false; }
void StorySync::startFile() { endJob(); }
void StorySync::streamSlice() { endJob(); }
void StorySync::finishFile() {}
void StorySync::retryOrFail(const char*) { endJob(); }
void StorySync::commitBundle() { endJob(); }
```

- [ ] **Step 3: Wire it in `device/src/main.cpp`**

Add the include after `#include "AudioDriver.h"`:

```cpp
#include "StorySync.h"
```

Add the instance after `AudioDriver audioDriver;`:

```cpp
StorySync storySync;  // OTA story delivery (part 3); no Lua surface
```

In `makeConfig()`, extend the extensions list:

```cpp
    cfg.extensions    = {&displayDriver, &buzzerDriver, &buttonDriver, &audioDriver, &storySync};
```

In `setup()`, after the `sandbox.onTransportsWillConnect(...)` block and before `sandbox.setup();`:

```cpp
    storySync.attach(&sandbox, &displayDriver);
    sandbox.onMessage([](const char* transport, const char* type, JsonDocument& doc) {
        (void)transport;
        if (strcmp(type, "story_fetch") == 0) storySync.onStoryFetch(doc);
    });
```

- [ ] **Step 4: Compile**

Run: `cd device && pio run && cd ..`
Expected: SUCCESS, firmware size within the 3.5 MB app partition (compare against the pre-change build size printed in the same output).

- [ ] **Step 5: Commit**

```bash
git add device/lib/drivers/src/StorySync.h device/lib/drivers/src/StorySync.cpp device/src/main.cpp
git commit -m "feat: StorySync scaffold — story_fetch intake, sanitization, replies, boot cleanup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `StorySync` fetch engine — HTTP streaming, verify, evict, commit

**Files:**
- Modify: `device/lib/drivers/src/StorySync.cpp` (replace the six Task-6 stubs)

**Interfaces:**
- Consumes: everything Task 5 defined (state machine fields, `sendDone`/`sendFailed`, `removeDirRecursive`, `endJob`).
- Produces: the complete state machine. On-device CRC via `esp_rom_crc32_le(crc, buf, len)` chained from 0 (`#include "esp_rom_crc.h"`).

- [ ] **Step 1: Replace the stubs with the engine**

Delete the `// ── Task 6 stubs` block and add (plus `#include "esp_rom_crc.h"` at the top of the file, after `#include <LittleFS.h>`):

```cpp
// ── space & eviction ────────────────────────────────────────────────────────
// /stories/.index is a JSON array of bundle names in fetch order — LittleFS
// has no timestamps, so this file is the eviction clock.

static bool readIndex(JsonDocument& doc) {
  File f = LittleFS.open("/stories/.index", "r");
  if (!f) return false;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  return !err && doc.is<JsonArray>();
}

static void writeIndex(JsonDocument& doc) {
  File f = LittleFS.open("/stories/.index", "w");
  if (!f) return;
  serializeJson(doc, f);
  f.close();
}

bool StorySync::ensureSpace() {
  uint64_t need = SPACE_SLACK;
  for (int i = 0; i < _fileCount; i++) need += _files[i].size;
  for (;;) {
    uint64_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
    // A same-name re-fetch reclaims the old copy at commit; count it as free.
    // (Conservative: metadata overhead is covered by SPACE_SLACK.)
    if (freeBytes >= need) return true;
    JsonDocument idx;
    const char* victim = nullptr;
    if (readIndex(idx)) {
      for (JsonVariant v : idx.as<JsonArray>()) {
        const char* name = v.as<const char*>();
        if (name && strcmp(name, _bundle) != 0) { victim = name; break; }
      }
    }
    if (!victim) {
      char reason[96];
      snprintf(reason, sizeof(reason), "no space: need %llu, free %llu, nothing to evict",
               (unsigned long long)need, (unsigned long long)freeBytes);
      sendFailed(reason);
      return false;
    }
    Serial.printf("[story_sync] evicting %s\n", victim);
    removeDirRecursive(String("/stories/") + victim);
    JsonDocument next;
    JsonArray arr = next.to<JsonArray>();
    for (JsonVariant v : idx.as<JsonArray>()) {
      if (strcmp(v.as<const char*>(), victim) != 0) arr.add(v);
    }
    writeIndex(next);
  }
}

// ── per-file fetch ──────────────────────────────────────────────────────────

void StorySync::startFile() {
  if (_fileIndex >= _fileCount) { commitBundle(); return; }
  FileEntry& f = _files[_fileIndex];
  String url = String(_baseUrl) + f.name;
  _http.setConnectTimeout(HTTP_TIMEOUT_MS);
  _http.setTimeout(HTTP_TIMEOUT_MS);
  _http.begin(_wifi, url);
  int code = _http.GET();
  if (code != 200) {
    _http.end();
    char why[48];
    snprintf(why, sizeof(why), "http %d", code);
    retryOrFail(why);
    return;
  }
  String tmpPath = String("/stories/") + _bundle + ".tmp/" + f.name;
  _out = LittleFS.open(tmpPath, "w");
  if (!_out) {
    _http.end();
    retryOrFail("open failed");
    return;
  }
  _crc = 0;
  _received = 0;
  _lastDataMs = millis();
  _state = State::Streaming;
  showProgress();
}

void StorySync::streamSlice() {
  FileEntry& f = _files[_fileIndex];
  WiFiClient* stream = _http.getStreamPtr();
  uint8_t buf[1024];
  size_t budget = SLICE_BYTES;
  while (budget > 0) {
    int avail = stream ? stream->available() : 0;
    if (avail <= 0) break;
    size_t want = min((size_t)avail, min(budget, sizeof(buf)));
    int n = stream->readBytes(buf, want);
    if (n <= 0) break;
    _out.write(buf, n);
    _crc = esp_rom_crc32_le(_crc, buf, n);
    _received += n;
    budget -= n;
    _lastDataMs = millis();
  }
  if (_received >= f.size) { finishFile(); return; }
  if (stream && !stream->connected() && stream->available() <= 0) {
    retryOrFail("connection closed early");
    return;
  }
  if (millis() - _lastDataMs > STREAM_STALL_MS) {
    retryOrFail("stalled");
    return;
  }
  if (millis() - _lastProgressMs > 500) showProgress();
}

void StorySync::finishFile() {
  FileEntry& f = _files[_fileIndex];
  _out.close();
  _http.end();
  if (_received != f.size) { retryOrFail("size mismatch"); return; }
  if (_crc != f.crc32) { retryOrFail("crc32 mismatch"); return; }
  _totalBytes += _received;
  _fileIndex++;
  _attempt = 0;
  _state = State::StartFile;
}

void StorySync::retryOrFail(const char* why) {
  abortFile();
  FileEntry& f = _files[_fileIndex < _fileCount ? _fileIndex : 0];
  if (++_attempt <= FILE_RETRIES) {
    Serial.printf("[story_sync] retry %d/%d %s: %s\n", _attempt, FILE_RETRIES, f.name, why);
    _retryAtMs = millis() + 500 * _attempt;  // linear backoff: 0.5s, 1s, 1.5s
    _state = State::StartFile;
    return;
  }
  char reason[96];
  snprintf(reason, sizeof(reason), "%s: %s", why, f.name);
  sendFailed(reason);
  removeDirRecursive(String("/stories/") + _bundle + ".tmp");
  endJob();
}

// ── commit ──────────────────────────────────────────────────────────────────

void StorySync::commitBundle() {
  String tmp = String("/stories/") + _bundle + ".tmp";
  String finalDir = String("/stories/") + _bundle;

  // Receipt first, into the tmp dir — the rename below publishes it atomically.
  JsonDocument doc;
  doc["bundle"] = _bundle;
  JsonArray arr = doc["files"].to<JsonArray>();
  for (int i = 0; i < _fileCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["path"] = _files[i].name;
    o["size"] = _files[i].size;
    char hex[9];
    snprintf(hex, sizeof(hex), "%08x", (unsigned)_files[i].crc32);
    o["crc32"] = hex;
  }
  File f = LittleFS.open(tmp + "/.manifest.json", "w");
  if (!f) { sendFailed("receipt write failed"); removeDirRecursive(tmp); endJob(); return; }
  serializeJson(doc, f);
  f.close();

  removeDirRecursive(finalDir);
  if (!LittleFS.rename(tmp, finalDir)) {
    sendFailed("rename failed");
    removeDirRecursive(tmp);
    endJob();
    return;
  }

  JsonDocument idx;
  JsonDocument next;
  JsonArray order = next.to<JsonArray>();
  if (readIndex(idx)) {
    for (JsonVariant v : idx.as<JsonArray>()) {
      if (strcmp(v.as<const char*>(), _bundle) != 0) order.add(v);
    }
  }
  order.add(_bundle);
  writeIndex(next);

  sendDone(false);
  if (_display) {
    char msg[64];
    snprintf(msg, sizeof(msg), "Story ready\n%s", _bundle);
    _display->displayText(msg);
  }
  endJob();
}
```

- [ ] **Step 2: Compile**

Run: `cd device && pio run && cd ..`
Expected: SUCCESS. If `esp_rom_crc.h` is not found on this core, use `#include "rom/crc.h"` and `crc32_le(crc, buf, n)` instead — same ROM routine, older header name; note the substitution in the commit message.

- [ ] **Step 3: Commit**

```bash
git add device/lib/drivers/src/StorySync.cpp
git commit -m "feat: StorySync fetch engine — streamed HTTP pull, CRC verify, evict, atomic commit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: ⚠️ HARDWARE checkpoint — M0/M1 (flash + fetch checklist)

Requires the user, the StickS3 on USB (once), and the device + Mac on the same WiFi.

**Files:** none (verification only). Findings that force code changes loop back to Task 5/6 files.

- [ ] **Step 1: Flash the new firmware**

```bash
cd device && pio run -t upload && cd ..
```

Then open the serial monitor: `cd device && pio device monitor && cd ..`
Expected: boot log, LittleFS mounts, relay connects (`<device-id>`).

- [ ] **Step 2: M0 — one file over the air**

```bash
npm run serve:bundle -- --bundle fixtures/knight-and-lonely-dragon &
npm run serve:bundle -- --bundle fixtures/knight-and-lonely-dragon --manifest > /tmp/manifest.json
```

Build a one-file announce from the manifest's first entry and POST it:

```bash
node -e '
const m = require("fs").readFileSync("/tmp/manifest.json","utf8");
const man = JSON.parse(m);
const body = { type: "story_fetch", bundle: man.bundle,
  base_url: process.argv[1], files: [man.files[0]] };
console.log(JSON.stringify(body));
' "http://<LAN-IP>:<PORT>/knight-and-lonely-dragon/" > /tmp/announce.json
curl -s -X POST https://resident.inanimate.tech/devices/<device-id>/send \
  -H 'Content-Type: application/json' --data @/tmp/announce.json
```

Verify: serial shows the fetch; the server logs one 200 with the right byte count; serial shows `done` (a one-file "bundle" commits — that's fine for M0). **CRC equivalence check:** no `crc32 mismatch` in serial proves `esp_rom_crc32_le` matches `tools/lib/crc32.ts`. Note observed throughput for the record.

- [ ] **Step 3: M1 — whole story, atomically**

POST the full-manifest announce (same `node -e` with `files: man.files`). Checklist, each verified via serial + the server log + the LCD:

- [ ] Full fetch completes; LCD shows progress then "Story ready"; `story_fetch_done` in serial.
- [ ] Re-POST the identical announce → single `.already` (204) in the server log, `already: true` reply, no audio re-transferred.
- [ ] Doctored announce (edit one `crc32` in `/tmp/announce.json`) → per-file retries then `story_fetch_failed` with `crc32 mismatch`, tmp dir gone, prior good copy intact.
- [ ] Doctored announce (hostile path `"../evil.wav"`) → `bad announce: file entry`, nothing written.
- [ ] Power-cut mid-fetch (pull power during the progress bar), reboot → serial shows stale `.tmp` cleanup; re-announce completes clean.
- [ ] Eviction: fetch `meet-the-troupe`, then `lighthouse-and-fog`, then re-fetch `knight-and-lonely-dragon` — when space runs short the oldest evicts (serial `evicting ...`), never the incoming bundle.
- [ ] A pushed story app still plays from the fetched files (push `knight-and-lonely-dragon.device.lua` via `/resident:push-app`, confirm audio).

- [ ] **Step 4: Record results**

Append observed throughput, slice-size verdict, and any checklist deviations to the plan file under this task, then commit:

```bash
git add docs/superpowers/plans/2026-07-23-device-track-part3-ota-story-delivery.md
git commit -m "docs: M0/M1 hardware checkpoint results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

#### RESULTS — run 2026-07-31 / 2026-08-02, device `<device-id>`

**M0 — one file over the air: PASS.** `GET returned 200 after 66ms`; 133,122 bytes in ~1.4s ≈ **95 KB/s**.
**CRC equivalence proven:** `finishFile crc=44acda30 == expect=44acda30`, i.e. on-device
`esp_rom_crc32_le` chained from 0 equals `tools/lib/crc32.ts` (zlib/IEEE). **Slice-size verdict:** the
16 KB `SLICE_BYTES` budget is adequate — no starvation, no watchdog pressure; left unchanged.

**M0 was blocked for a full session by a defect this checkpoint existed to catch.** `Sandbox::loop()`
ticks non-peripheral extensions *only while an app is loaded*, so on an app-less device
`StorySync::update()` was never called: the state machine parked in `StartFile`, no GET was ever
issued, and the LCD sat at `0%` forever. Every network-shaped hypothesis (firewall, AP isolation,
2.4 vs 5 GHz, hotspot migration) was chasing a ghost — the device was never making a request. Found
by instrumenting rather than theorising; the decisive signal was an *absent* log line. Fixed in
`device/src/main.cpp` (commit `6caf8f0`) by ticking StorySync from the sketch's `loop()` under the
same predicate the sandbox uses. Spec, quality and security reviews all passed this code — the bug
was in an assumption about the surrounding lifecycle contract, which only hardware could expose.

**M1 checklist:**

| Item | Result |
|---|---|
| Full fetch, LCD progress → "Story ready", `story_fetch_done` | ✅ 19 files, 1,726,316 bytes |
| Re-POST identical announce → `.already` 204, no audio re-transferred | ✅ `already=1 bytes=0` |
| Doctored `crc32` → retries, `crc32 mismatch`, tmp gone, prior copy intact | ✅ |
| Hostile path `"../evil.wav"` → `bad announce: file entry`, nothing written | ✅ rejected before any GET |
| Power-cut mid-fetch → stale `.tmp` cleanup on reboot | ⬜ **NOT RUN** — see below |
| Eviction: oldest evicts, never the incoming bundle | ✅ see below |
| Pushed app plays from fetched files | ✅ **success criterion 1** |

**Eviction (the item with no prior hardware exposure) — PASS, but the first attempt was
inconclusive and the reason is worth keeping.** Alternating `lighthouse-and-fog` (1.76 MB) and
`meet-the-troupe` (2.94 MB) can never coexist in 4.4 MB, so every job evicted exactly once from a
single-candidate set — which proves nothing about *order*, since picking the only candidate passes
even with a broken clock. Re-run starting from the two bundles that do fit together:

- **Coexistence:** knight fetched while lighthouse resident (1.76 + 1.73 = 3.49 MB) with **no
  `evicting` line at all** → `ensureSpace()` does not over-evict.
- **Loop-until-fits:** `meet-the-troupe` (needs 3,005,602 B, ~1.1 MB free) produced **two** eviction
  lines in one job → the loop repeats instead of giving up after one victim.
- **Oldest-first:** `evicting lighthouse-and-fog` **then** `evicting knight-and-lonely-dragon`,
  matching actual fetch order (step B was run before step A) rather than directory order.
- **Never-the-incoming:** held across every run.

**Two unplanned findings, both kept:**
1. **Concurrency guard works** — `story_fetch_failed` reason `busy`. Verified in
   `StorySync.cpp:327-336` that `busy` is replied only when the incoming bundle *differs*; a
   same-bundle re-announce aborts and restarts. That is what makes push-story's "no progress for
   60s → re-announce" recovery provably safe.
2. **Retry recovery proven on a real transient error** — `retry 1/3 aud_006.wav: http -5` and the
   fetch then *completed*. Stronger evidence than the doctored-CRC test, which only exercised the
   give-up path.

**Deviations from the checklist as written:**

- **Power-cut recovery not run.** USB removal is not a power cut — the StickS3 has a LiPo — and the
  two commit-recovery windows are milliseconds wide, so hand timing cannot hit them. Deterministic
  instrumentation was written instead (`-DSS_CRASH_AT=N`, resetting the SoC at each window) and
  built clean, but the human scoped the run down before executing it. **The two crash-window
  recovery paths added by the Task 6 hardening remain code-reviewed but unexercised on hardware.**
- **Blocking-GET weakness confirmed biting:** each failed GET blocks the loop for the full 10s
  `HTTP_TIMEOUT_MS` (4 attempts ≈ 40s stalled). The reviewer's Minor finding now has hardware
  evidence. Follow-up, not a blocker.
- **Cosmetic:** the happy path emits `[E][vfs_api.cpp]` lines (boot cleanup probing a non-existent
  `.tmp`, the atomic index write unlinking a non-existent `.index.tmp`). LittleFS's VFS shim logs
  ENOENT at ERROR level. Noisy in a demo; not a correctness issue.

**Success criterion 3 ("no failure sequence leaves a previously delivered story unplayable") is
therefore PARTIALLY evidenced** — supported by the CRC-failure and hostile-path cases and by
eviction never touching the incoming bundle, but not by a crash-during-commit test.

---

### Task 8: The `push-story` skill

**Files:**
- Create: `.claude/skills/push-story/SKILL.md`

**Interfaces:**
- Consumes: `npm run serve:bundle` (Task 4 CLI + log format), the `story_fetch` announce shape (Task 5), `/resident:push-app` (existing plugin skill).
- Produces: the skill future sessions (and Task 10's story-director edit) invoke by name.

- [ ] **Step 1: Write the skill**

```markdown
---
name: push-story
description: Deliver a story bundle to one or more Improv StickS3 devices over the air — audio over LAN HTTP, app over the Resident relay, no USB. Use when asked to push, load, deliver, or sync a story onto the device(s), including "put this on both devices". Takes a bundle directory under fixtures/ and optional device ids.
---

# Push Story

Delivers a validated bundle: `serve:bundle` serves the WAVs on the LAN, a `story_fetch` announce over the relay tells each device to pull them, the server's request log confirms delivery, then the built device app is pushed via `/resident:push-app`.

**Preconditions:** the device runs this repo's `device/` firmware with StorySync (part 3+), and is on the same network as this Mac. Default device id: `<device-id>`.

## Steps

1. **Gate + build.** `npm run validate -- <bundle>/performance.json --check-files`, then `npm run build:app -- --bundle <bundle> --target device`. Stop on any error — never deliver an unvalidated bundle.
2. **Manifest.** `npm run serve:bundle -- --bundle <bundle> --manifest` → capture the JSON (`bundle`, `files`).
3. **Serve.** Start `npm run serve:bundle -- --bundle <bundle>` in the background, capturing output to a log file. The first line is `serving http://<host>:<port>/<name>/` — that is `base_url`. If the Mac is multi-homed or on a VPN, pass `--host <lan-ip>`.
4. **Announce** to each device id:

       curl -s -X POST https://resident.inanimate.tech/devices/<id>/send \
         -H 'Content-Type: application/json' \
         -d '{"type":"story_fetch","bundle":"<name>","base_url":"<base_url>","files":<files from step 2>}'

5. **Watch the log.** One JSON line per request (`path`, `status`, `bytes`, `remote`). Success per device: every manifest `path` served with status 200 to that device's IP, **or** one `.already` (204) hit from it. No new lines for 60s → re-announce (idempotent, safe). Give up at 5 minutes and diagnose in order: device powered and on WiFi? Same network as this Mac (guest-WiFi isolation)? Wrong `--host` (VPN / multi-homed)? Firmware predates StorySync?
6. **Push the app.** `/resident:push-app --device-id <id> device-apps/improv/build/<name>.device.lua` for each device.
7. **Stop the server** (kill the background process) and report per-device outcomes: fetched bytes or `already`, and app push result.

## Notes

- The audio fetch and the app push are independent: a fetch that succeeded is durable (atomic on-device commit), so a failed app push can be retried alone.
- Multiple devices share one server; announce each id, watch for each device's IP in the log.
- The device screen shows fetch progress and "Story ready" / failure text — useful when diagnosing without serial.
```

- [ ] **Step 2: Verify the skill loads**

Confirm the file parses as skill frontmatter (name + description present, no tabs). In a repo session, the skill list should show `push-story`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/push-story/SKILL.md
git commit -m "feat: push-story skill — OTA bundle delivery via serve-bundle + relay announce

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: ⚠️ HARDWARE checkpoint — M2 (`push-story` end to end, no cable)

Requires the user; USB stays unplugged throughout.

- [ ] **Step 1:** With the device on WiFi and no USB connected, invoke the `push-story` skill for `fixtures/lighthouse-and-fog` (device `<device-id>`), following it exactly as written.
- [ ] **Step 2:** Verify: server log shows the full manifest served; device plays *The Lighthouse and the Fog* end to end with audio — this also closes Part 2's leftover (second story on physical hardware).
- [ ] **Step 3:** Re-run the same invocation → `.already` path, completes in seconds, app re-push still works.
- [ ] **Step 3b (if a second StickS3 is available):** invoke `push-story` with both device ids in one run — one server, two announces, both devices' IPs complete in the log (success criterion 5). If no second device exists yet, note that here and carry the criterion forward to the multi-device work.
- [ ] **Step 4:** Fix any skill-text friction discovered (unclear step, wrong command) in `SKILL.md`, then commit:

```bash
git add .claude/skills/push-story/SKILL.md docs/superpowers/plans/2026-07-23-device-track-part3-ota-story-delivery.md
git commit -m "docs: M2 checkpoint — push-story proven end to end, skill text polished

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

#### RESULTS — run 2026-08-04, device `<device-id>` (Mac `<mac-lan-ip>`, device `<device-lan-ip>`)

**M2 PASSES.** The skill was followed end to end against three bundles. Two produced full
real transfers and played with full audio; the third exposed a hard limit that is not this
branch's to fix (see below).

| Bundle | Files | Bytes served → expected | Non-200s / retries | App on the wire | Outcome |
|---|---|---|---|---|---|
| `meet-the-troupe` | `.already` 204 | 0 (already committed) | none | 71,361 B | ❌ app dropped, `NoMemory` |
| `lighthouse-and-fog` | 17/17 | 1,759,946 = 1,759,946 | none | 48,776 B | ✅ played |
| `knight-and-lonely-dragon` | 19/19 | 1,726,316 = 1,726,316 | none | 51,945 B | ✅ played, full audio |

Byte-exact on both real transfers, every response 200, zero retries. **Success criterion 1
is now demonstrated twice, on two different stories, with genuine transfers rather than the
`.already` shortcut** — which also closes Part 2's leftover (the second story on physical
hardware). Criterion 4 was demonstrated again by `meet-the-troupe`'s `.already` 204.

**Step 3b / success criterion 5 (two device ids in one run): NOT RUN — only one StickS3 is
available.** Was carried forward to the multi-device work; **that criterion was retired on
2026-08-06** as not required, so nothing is outstanding here. `push-story` still accepts N
device ids — the capability exists, it just is not a gate.

**Eviction was NOT observed in these runs and remains unconfirmed here.** Knight needed
1,791,852 B with slack on a 4.4 MB partition while lighthouse (1.76 MB) had been fetched
minutes earlier, so an eviction was expected and no `evicting` line was seen. The most likely
explanation is simply that the resident set was smaller than assumed (`meet-the-troupe` may
already have been evicted during the M1 work), but that is a hypothesis, not an observation —
do not record it as a finding. Eviction itself is separately proven on hardware by M1 item 5f,
which exercised coexistence, loop-until-fits and oldest-first ordering deliberately. The gap
here is only that the device's stored set was never read back directly; there is no
on-device way to dump `/stories/.index` today, which is what made this unresolvable in the
moment. Worth a small serial-side debug command if this comes up again.

**Step 4 — skill friction found and fixed.** Running the skill (rather than reading it)
surfaced five defects, all committed:

1. `head -1` on the server log returns npm's `> serve:bundle` preamble, not the base URL —
   the skill warns about this exact preamble for the manifest step and then walked into it
   one step later. Now greps `'^serving '`. (`c144c9b`)
2. No entry for the relay's `Device not connected` (503); the nearest advice sent the reader
   to inspect the device when the POST response was already definitive. (`c144c9b`)
3. The worked example still carried both of the above after the Steps section was fixed —
   worse than either alone, since the example is what gets copy-pasted. (`53a0dae`)
4. Step 8 did not warn that the step-5 reachability probe appears in the request log as a
   200 from the *Mac's* IP, structurally identical to a device fetch. (`53a0dae`)
5. The `EADDRINUSE` escape hatch could match an in-flight device connection; now restricted
   with `-sTCP:LISTEN`. (`53a0dae`)

Plus the app-push size ceiling and the WiFi config-portal fallback documented in `e7afe81`.

**The `meet-the-troupe` failure is a real architectural finding, not a flaw in this branch.**
Its 68,748-byte app becomes a 71,368-byte JSON message, and `Courier::Client::dispatchJSON`
parses each inbound message into a heap `JsonDocument`, so the allocation fails and the device
drops it — while `push.sh` exits 0 because the *relay* accepted it. Measured: 50,035 B pushes
and runs, 68,748 B does not; the ceiling moves with free heap. Sprite art is 68–78% of every
app and scales with cast size rather than story length, so the story that casts the whole
troupe is the worst case by construction. Written up as
`docs/superpowers/specs/2026-08-04-troupe-art-residency-design.md`.

---

### Task 10: `story-director` run-loop edit

**Files:**
- Modify: `.claude/skills/story-director/SKILL.md` (the "Running it" **Device** block only — the spec bounds this edit to that block)

- [ ] **Step 1: Replace the Device block**

The current block reads:

```markdown
**Device** (StickS3 flashed with this repo's `device/` firmware):
```sh
npm run pack:audio -- --bundle fixtures/<name>     # respects the flash budget; the tool refuses over-budget packs
cd device && pio run -t uploadfs && cd ..          # only when staged audio changed
npm run build:app -- --bundle fixtures/<name> --target device
```
then `/resident:push-app --device-id <id> device-apps/improv/build/<name>.device.lua`.
```

Replace it with:

```markdown
**Device** (StickS3 flashed with this repo's `device/` firmware): delegate to the **push-story** skill — it validates, builds the device target, serves the bundle's audio over LAN HTTP, announces the fetch over the relay, waits for delivery, and pushes the app. Invoke it with the bundle dir (and device ids if not the default `<device-id>`). The device manages its own story storage, evicting the oldest fetched story when space runs short — no flash-budget math needed here. (`pack:audio` + `uploadfs` over USB is only for provisioning a freshly flashed device — see README.)
```

- [ ] **Step 2: Verify the edit is bounded**

Run: `git diff .claude/skills/story-director/SKILL.md`
Expected: the diff touches only the Device block — interview, review contract, sim path, update path all untouched.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/story-director/SKILL.md
git commit -m "feat: story-director device run loop delegates to push-story (OTA)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: README rewrite

**Files:**
- Modify: `README.md` — the "Playing it on the device" section and the "Status & next steps" section

- [ ] **Step 1: Rewrite "Playing it on the device"**

Replace the section's body (the `pack:audio` / `uploadfs` / `build:app` loop and the paragraph after the push command) with:

```markdown
Once the StickS3 is flashed with this repo's `device/` firmware (see
[`DEVICE-SKILL.md`](DEVICE-SKILL.md) for the Lua surface it exposes), stories are delivered
**over the air** — no USB. From a Claude Code session in this repo, invoke the **push-story**
skill with the bundle:

    push-story fixtures/knight-and-lonely-dragon

It validates the bundle, builds the device app, serves the audio over LAN HTTP
(`npm run serve:bundle`), announces a `story_fetch` to the device over the Resident relay, waits
until the device has pulled and verified every file (atomic on-device commit — a failed fetch
never corrupts a delivered story), then pushes the app via `/resident:push-app`. Re-pushing an
unchanged bundle transfers nothing and completes in seconds. Requires the device and the Mac on
the same network.

USB (`npm run pack:audio` + `cd device && pio run -t uploadfs`) remains only as a
firmware-provisioning path — e.g. pre-loading a story onto a freshly flashed device with no
WiFi configured. Flashing firmware proper (`pio run -t upload`, from `device/`) is still only
needed when something under `device/` changes.
```

- [ ] **Step 2: Update "Status & next steps"**

In the status paragraph, mark device track part 3 done (over-the-air delivery via StorySync + `push-story`; second story proven on hardware at M2) and reduce the "next moves" list to the minimal cloud pipeline item.

- [ ] **Step 3: Full gate + commit**

```bash
npm run typecheck && npm test
git add README.md
git commit -m "docs: README — over-the-air story delivery replaces the USB loop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: ⚠️ HARDWARE checkpoint — M3 (idea to played)

> **CARRIED FORWARD 2026-08-04 — do not run this from here.** M3 now lives in
> `docs/superpowers/specs/2026-08-04-troupe-art-residency-design.md`
> as that spec's final acceptance test, and should be run after it is planned and executed.
>
> Reason: a brand-new story's deliverability currently depends on how many actors
> `story-director` casts, which the author does not control and cannot predict during the
> interview. Four actors builds a ~47–50 KB app that pushes fine; seven builds a 68,748-byte app
> that Courier drops on arrival. Running M3 before the art is resident would produce an ambiguous
> result — a failure would not distinguish "the authoring flow is broken" from "this story cast
> one actor too many". Once sprite art stops riding in the app payload, app size no longer tracks
> cast size and M3 becomes a clean test of the authoring-to-playback pipeline.
>
> **Success criterion 2 therefore remains open at the close of Part 3.** The steps below stand as
> written; only their timing moved.
>
> **Closed 2026-08-06** — see "M3 result" below. It ran once troupe-art residency landed, exactly
> as anticipated here.

Requires the user (and ideally the child).

- [x] **Step 1:** Author a brand-new story through the `story-director` skill (a fresh seed, not a committed fixture), following its full review contract.
- [x] **Step 2:** Its run loop should now end in `push-story`; confirm the new story plays on the StickS3 with no USB at any point.
- [x] **Step 3:** Commit the new bundle (fixtures + built apps) as story-director's flow produces it, and append the demo result to this plan file:

### M3 result — PASSED, 2026-08-06

**Success criterion 2 is closed.** `fixtures/biscuit-comes-home` ("Biscuit Comes Home") went from
a child's idea to playing on StickS3 `<device-id>` with no USB at any point. Commit `e8b83d3`.

The seed was the child's and complete in arc — a princess loses her dog, cries in her bedroom,
the king announces a delivery, and the prince is at the entrance holding the dog. One question was
asked (the dog's name: Biscuit); the child also rejected a proposed detail and supplied a better
one (a doorbell at the entrance rather than a discovery in the woods), which is the review contract
working as intended. The king's line is verbatim.

15 beats, 46.3 s measured, 5 actors cast. Delivery: 18/18 audio files over LAN HTTP, then an
18,883-byte app over the relay.

**Why this was blocked on troupe-art residency, and what it proves.** M3 could not be run
reliably while actor art shipped inside each app, because app size tracked cast size and the
author cannot predict the cast during the interview — a seven-actor story built to 69,896 bytes
and was dropped by Courier with `NoMemory`. With art resident in firmware
(`docs/superpowers/specs/2026-08-04-troupe-art-residency-design.md`), that coupling is gone, and
the committed bundles now demonstrate it directly:

| Story | Actors cast | Device app |
|---|---|---|
| `the-real-panda-showdown` | 3 | 19,026 B |
| `lighthouse-and-fog` | 4 | 18,627 B |
| `knight-and-lonely-dragon` | 4 | 18,789 B |
| `biscuit-comes-home` | 5 | 18,883 B |
| `meet-the-troupe` | 7 | **18,561 B** |

The three-actor story is the largest and the seven-actor story the smallest. Size now tracks
story length, not cast size, so a new story's deliverability is no longer a lottery decided by
casting.

(`the-real-panda-showdown` was deleted from the repo after this measurement. Its row is kept
deliberately — it is the three-actor data point, and removing it would weaken a record of what
was measured rather than correct it.)

**One friction point found by running it:** `tests/bundle-lib.test.ts` asserts the exact bundle
inventory, so adding any story fails the suite until the list is updated. Correct behaviour for an
inventory assertion, but worth knowing it is a required step when authoring.

Original Step 3 commit instructions, kept for the record:

```bash
git add fixtures/ device-apps/improv/build/ docs/superpowers/plans/2026-07-23-device-track-part3-ota-story-delivery.md
git commit -m "feat: first story delivered idea-to-played fully over the air (M3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Success criteria (from the spec)

1. A story reaches the device with no USB connection: audio over HTTP, app over the relay, one skill invocation.
2. A brand-new story goes from a child's idea to playing on the StickS3 via `story-director` + `push-story`. — **met 2026-08-06** (`biscuit-comes-home`, commit `e8b83d3`; see "M3 result" above).
3. Delivery is atomic: no failure sequence leaves a previously delivered story unplayable.
4. Repeat delivery of an unchanged bundle transfers no audio and completes in seconds.
5. ~~`push-story` handles two device ids in one invocation (delivery only).~~ **RETIRED 2026-08-06** — see the spec; not required.
6. `npm test` covers manifest, CRC, server, and staging-set parity; sim workflow and Part 2 behavior untouched.
