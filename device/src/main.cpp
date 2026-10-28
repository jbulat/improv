#include <M5Unified.h>
#include <LittleFS.h>
#include <Resident.h>
#include "DisplayDriver.h"
#include "BuzzerDriver.h"
#include "PushButtonsDriver.h"
#include "AudioDriver.h"
#include "StorySync.h"
#include "TroupeArtDriver.h"
#include "LittleFsAppStore.h"

// Resident relay. Senders POST JSON to https://<host>/devices/<deviceId>/send;
// the device holds a WebSocket on wss://<host>/devices/<deviceId>.
static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
static constexpr uint16_t RESIDENT_PORT = 443;

// M5StickS3 buttons. GPIO 37 is part of the OPI PSRAM interface on the S3 —
// digitalRead() on it triggers a watchdog reset. Use 11/12.
static constexpr uint8_t BUTTON_PINS[] = {11, 12};
static constexpr PushButtonsConfig buttonConfig = {.numButtons = 2, .pins = BUTTON_PINS};

// ---- Portrait orientation + IMU auto-flip ----------------------------------
// The screen is portrait (135x240) in both rotations; the IMU decides which
// end is up, because users stand the device on its USB end while the cable
// is plugged in. Rotations 0 and 2 have identical dimensions, so a flip needs
// no canvas realloc and is invisible to Lua apps.
//
// Body frame: X is the long axis, USB port toward -X. The StickS3 IMU reports
// X inverted relative to the body frame (the same remap as IMUDriver.cpp in
// the Resident m5stick demo). ROT_USB_DOWN and ROT_USB_UP are the M5GFX
// rotation indices for the USB end down and the USB end up.
static constexpr uint8_t ROT_USB_DOWN = 0;
static constexpr uint8_t ROT_USB_UP = 2;
static constexpr float FLIP_G = 0.6f;     // sustained lean needed to flip
static constexpr float BOOT_G = 0.4f;     // gentler: boot just needs a hint
static constexpr uint8_t FLIP_VOTES = 5;  // x ~100 ms polls = ~500 ms
static uint8_t g_rotation = ROT_USB_DOWN;

// Body-frame ax in g. Standing USB-down puts +X up, so ax reads ~ +1 g.
static float bodyAx() {
  M5.Imu.update();
  auto d = M5.Imu.getImuData();
  return -d.accel.x;  // StickS3 chip X inverted vs. body frame
}

static void pickBootRotation() {
  // Strong USB-up lean flips the boot pick; flat/unclear keeps the
  // USB-down default.
  if (bodyAx() <= -BOOT_G) g_rotation = ROT_USB_UP;
  M5.Display.setRotation(g_rotation);
}

// Poll ~10 Hz; flip only after FLIP_VOTES consecutive reads agree on the
// opposite lean. Hysteresis (|ax| must exceed FLIP_G) plus the debounce keeps
// the screen stable while the device is handled or lying flat (gravity then
// lives on other axes, |ax| stays small, and the last orientation holds).
static void updateOrientation() {
  static uint32_t lastPollMs = 0;
  static uint8_t votes = 0;
  uint32_t now = millis();
  if (now - lastPollMs < 100) return;
  lastPollMs = now;
  float ax = bodyAx();
  uint8_t want = g_rotation;
  if (ax >= FLIP_G)
    want = ROT_USB_DOWN;
  else if (ax <= -FLIP_G)
    want = ROT_USB_UP;
  if (want == g_rotation) {
    votes = 0;
    return;
  }
  if (++votes >= FLIP_VOTES) {
    g_rotation = want;
    M5.Display.setRotation(g_rotation);
    votes = 0;
  }
}

DisplayDriver displayDriver;
BuzzerDriver buzzerDriver;  // master volume is AudioDriver's (one speaker)
PushButtonsDriver buttonDriver{buttonConfig};
AudioDriver audioDriver;
StorySync storySync;              // OTA story delivery; no Lua surface
TroupeArtDriver troupeArtDriver;  // resident sprite art (troupe.install)
LittleFsAppStore appStore;        // last app on LittleFS; nvs is far too small

Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "improv";
  cfg.extensions = {&displayDriver, &buzzerDriver, &buttonDriver,
                    &audioDriver,   &storySync,    &troupeArtDriver};
  cfg.systemDisplay = &displayDriver;
  cfg.systemButton = &buttonDriver;  // tap = load persisted app, hold = forget

  // Resident's default store is NVS, whose 20,480 B partition (shared with
  // WiFi credentials) cannot hold a story app. LittleFS has ~4.3 MB and is
  // already mounted for story audio.
  cfg.persistentStore = &appStore;

  // The slowest dispatch is the app load, ~550 ms on hardware, almost all of
  // it Lua sprite decode, which is bounded by the resident art set rather
  // than by story length. 4x headroom, rounded up to the next 500 ms.
  cfg.executionDeadlineMs = 2500;
  // Reports (does not abort) a slow dispatch. Set clear of a clip-preload
  // tick (audio.lua), which can take ~500 ms for four large clips.
  cfg.executionSoftDeadlineMs = 1000;

  Courier::Config courier;
  courier.host = RESIDENT_HOST;
  courier.port = RESIDENT_PORT;
  // Courier drops every inbound message unless defaultTransport matches the
  // transport name: dispatchJSON() returns early when it is null, although
  // transport registration treats null as "ws". Receive is silent without this.
  courier.defaultTransport = "ws";
  cfg.network = courier;
  return cfg;
}

Resident::Sandbox sandbox{makeConfig()};

// ---- Boot restore ----------------------------------------------------------
// Resident restores a persisted app only once its connection state machine
// reaches Connected, so a device away from known WiFi would sit on the
// connection screen (or in the WiFiManager portal) without its story. Restore
// here instead, before Courier has resolved anything.
//
// A successful load supersedes Resident's own pending restore: loadAppInternal
// clears RunState::Pending and the pending source, and enterIdleScreen() does
// nothing once an app is running, so a later connection neither re-arms the
// 20 s countdown nor repaints over the story. The skip branch in setup() is
// the exception (see its comment).
static constexpr uint32_t BOOT_SKIP_POLL_MS = 300;
static constexpr uint32_t BOOT_SKIP_SAMPLE_MS = 10;

// Hold the front button through power-on to skip the restore and reach the
// identity screen (the device ID is needed to push new stories).
//
// This reads the pin level, not buttonDriver.pressed(): pressed() is an edge
// latch, and a button already held when begin() sampled it never produces an
// edge. Sampling across the window is the debounce. A three-quarter majority
// tolerates contact chatter, since an untouched button reads HIGH on every
// sample and a held one LOW.
static bool bootSkipHeld() {
  uint32_t samples = 0;
  uint32_t down = 0;
  const uint32_t start = millis();
  while (millis() - start < BOOT_SKIP_POLL_MS) {
    samples++;
    if (buttonDriver.heldLevel(0)) down++;
    delay(BOOT_SKIP_SAMPLE_MS);
  }
  return samples > 0 && down * 4 >= samples * 3;
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // wait for USB CDC
  auto cfg = M5.config();
  M5.begin(cfg);
  pickBootRotation();

  // The partition label must match device/partitions.csv ("littlefs").
  // LittleFS.begin() defaults to the label "spiffs", so without the explicit
  // label it fails to find our partition and mounts nothing.
  if (!LittleFS.begin(false, "/littlefs", 10, "littlefs")) {
    Serial.println("LittleFS mount failed — no filesystem uploaded?");
  }

  // Use the /devices/<id> path instead of Resident's default /agents/... path.
  // ws() asserts when there is no WS transport. makeConfig() always sets one,
  // so the hasWs() gate only turns a config mistake into a log, not a crash.
  sandbox.onTransportsWillConnect([]() {
    if (!sandbox.hasWs()) {
      Serial.println("[improv] no WS transport - cannot set /devices path");
      return;
    }
    String wsPath = String("/devices/") + sandbox.getDeviceId();
    sandbox.ws().setEndpoint(RESIDENT_HOST, RESIDENT_PORT, wsPath.c_str());
  });

  storySync.attach(&sandbox, &displayDriver);

  // OTA story delivery has its own channel. Resident routes by the message's
  // "channel" field and handles "app", "runtime" and "system" before its
  // channel registry, so a handler under one of those would never fire.
  // "story" covers story_fetch, story_fetch_done and story_fetch_failed.
  sandbox.onMessageWithChannel("story",
                               [](const char* transport, const char* type, JsonDocument& doc) {
                                 (void)transport;
                                 if (strcmp(type, "story_fetch") == 0) storySync.onStoryFetch(doc);
                               });

  // Accepts an un-channelled story_fetch, which Resident marks deprecated. A
  // channelled announce never reaches this hook (onCourierMessage returns
  // from the channel branch first), so one message is never handled twice.
  // Once the relay sends channel:"system" type:"hello", Resident drops
  // un-channelled frames and this hook stops firing.
  sandbox.onMessage([](const char* transport, const char* type, JsonDocument& doc) {
    (void)transport;
    if (strcmp(type, "story_fetch") == 0) storySync.onStoryFetch(doc);
  });

  sandbox.setup();

  // Load first, poll second: with nothing stored there is nothing to skip,
  // so a fresh device must not spend the 300 ms window.
  String saved = appStore.load();
  Serial.printf("[improv] boot: free heap %u before restore\n", (unsigned)ESP.getFreeHeap());
  if (saved.length() == 0) {
    Serial.println("[improv] boot: no saved story");
  } else if (bootSkipHeld()) {
    // Skips this boot's restore only. Resident's _pendingPersistedSource
    // (set by sandbox.setup()) is untouched, so once Courier connects, the
    // identity screen runs its usual 20 s countdown and then loads the app.
    // A long press during that countdown forgets the app for good.
    Serial.println("[improv] boot: button held, skipping story restore");
  } else {
    Serial.printf("[improv] boot: restoring %u byte app\n", (unsigned)saved.length());
    sandbox.loadApp(saved.c_str());
    if (sandbox.isAppRunning()) {
      // The app must reach `ready` before setup() returns. The first
      // loop() runs Courier's autoConnect(), which can block for ~20 s,
      // and the first on_tick is dispatched ahead of any queued event, so
      // a queued boot_restore alone would arrive after the story started.
      // This also cuts init()'s chime before it sounds.
      sandbox.loadChunk("S.player_hold()");
      // The event is the contract the host tests exercise; player_hold()
      // is idempotent, so the second call is harmless.
      sandbox.sendAppEvent("boot_restore", "{}");
    } else {
      // loadApp bypasses Resident's finishBootCountdown(), which normally
      // clears the store when a saved app fails to compile. Without this,
      // a truncated /app.lua is retried on every offline boot.
      Serial.println("[improv] boot: saved app failed to load; forgetting it");
      appStore.clear();
    }
    Serial.printf("[improv] boot: free heap %u after restore\n", (unsigned)ESP.getFreeHeap());
  }
}

void loop() {
  M5.update();
  updateOrientation();
  sandbox.loop();
  // Sandbox::loop ticks non-peripheral extensions only while an app is
  // loaded, but OTA story delivery must also work before any app exists. Tick
  // StorySync here exactly when the sandbox does not: one tick per loop.
  if (!sandbox.isAppRunning()) storySync.update();
}
