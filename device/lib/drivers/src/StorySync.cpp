#include "StorySync.h"
#include <LittleFS.h>
#include "esp_rom_crc.h"
#include <Resident.h>
#include "DisplayDriver.h"
#include "StorySyncCore.h"

// ── filesystem helpers ──────────────────────────────────────────────────────

// Delete-first iteration: repeatedly open the dir, remove its first entry,
// until empty — sidesteps iterator invalidation while deleting.
void StorySync::removeDirRecursive(const String& dirPath) {
  for (;;) {
    File dir = LittleFS.open(dirPath);
    if (!dir || !dir.isDirectory()) {
      if (dir) dir.close();
      break;
    }
    File entry = dir.openNextFile();
    if (!entry) {
      dir.close();
      break;
    }
    String p = entry.path();
    bool isDir = entry.isDirectory();
    entry.close();
    dir.close();
    if (isDir)
      removeDirRecursive(p);
    else
      LittleFS.remove(p);
  }
  LittleFS.rmdir(dirPath);
}

// Forward declarations: the atomic index reader/writer are defined below in
// the "space & eviction" section, but begin() needs them to complete pending
// commits and to reconcile the index with what's actually on disk.
static bool readIndex(JsonDocument& doc);
static void writeIndex(JsonDocument& doc);

// A tmp dir represents a completed-but-unpublished bundle iff it holds a
// parseable receipt with a non-empty files array — everything the fetch
// engine needs was already verified before the crash cut the final rename.
static bool hasCompletedReceipt(const String& tmpDir) {
  File f = LittleFS.open(tmpDir + "/.manifest.json", "r");
  if (!f) return false;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return false;
  JsonArray files = doc["files"].as<JsonArray>();
  return !files.isNull() && files.size() > 0;
}

// Appends `bundle` to /stories/.index if it isn't already present, writing
// the result via the atomic writer.
static void appendToIndexIfMissing(const char* bundle) {
  JsonDocument idx;
  JsonDocument next;
  JsonArray order = next.to<JsonArray>();
  bool present = false;
  if (readIndex(idx)) {
    for (JsonVariant v : idx.as<JsonArray>()) {
      const char* name = v.as<const char*>();
      if (name && strcmp(name, bundle) == 0) present = true;
      order.add(v);
    }
  }
  if (present) return;
  order.add(bundle);
  writeIndex(next);
}

void StorySync::begin() {
  File root = LittleFS.open("/stories");
  if (!root) return;
  const size_t prefixLen = String("/stories/").length();
  String stale[16];
  int staleCount = 0;
  for (File e = root.openNextFile(); e && staleCount < 16; e = root.openNextFile()) {
    String p = e.path();
    bool isTmpDir = e.isDirectory() && p.endsWith(".tmp");
    e.close();
    if (isTmpDir) stale[staleCount++] = p;
  }
  root.close();

  // A tmp dir left behind at boot is either a fully verified bundle that
  // only lacked its final rename (complete it: the data is good), or an
  // interrupted partial fetch (discard it).
  for (int i = 0; i < staleCount; i++) {
    const String& tmpPath = stale[i];
    String name = tmpPath.substring(prefixLen);
    name.remove(name.length() - 4);  // strip trailing ".tmp"
    if (!StorySyncCore::validBundleName(name.c_str())) {
      Serial.printf("[story_sync] ignoring unrecognized tmp entry %s\n", tmpPath.c_str());
      continue;
    }
    String finalDir = String("/stories/") + name;
    if (hasCompletedReceipt(tmpPath)) {
      Serial.printf("[story_sync] completing pending commit %s\n", name.c_str());
      removeDirRecursive(finalDir);
      if (LittleFS.rename(tmpPath, finalDir)) {
        appendToIndexIfMissing(name.c_str());
      } else {
        Serial.printf("[story_sync] rename failed completing %s\n", name.c_str());
      }
    } else {
      Serial.printf("[story_sync] removing stale %s\n", tmpPath.c_str());
      removeDirRecursive(tmpPath);
    }
  }

  // Reconcile /stories/.index with what's actually on disk: a crash between
  // commitBundle()'s rename and its index update (or between the completion
  // rename above and its own index update) leaves a valid, playable bundle
  // absent from the index — and therefore permanently un-evictable.
  File storiesRoot = LittleFS.open("/stories");
  if (storiesRoot) {
    JsonDocument idx;
    JsonDocument next;
    JsonArray order = next.to<JsonArray>();
    if (readIndex(idx)) {
      for (JsonVariant v : idx.as<JsonArray>()) order.add(v);
    }
    for (File e = storiesRoot.openNextFile(); e; e = storiesRoot.openNextFile()) {
      String p = e.path();
      bool isDir = e.isDirectory();
      e.close();
      if (!isDir) continue;
      String name = p.substring(prefixLen);
      // StorySyncCore::validBundleName naturally skips .index, .index.tmp, and any leftover
      // *.tmp dirs (all contain '.'), since those were already resolved above.
      if (!StorySyncCore::validBundleName(name.c_str())) continue;
      bool present = false;
      for (JsonVariant v : order) {
        const char* n = v.as<const char*>();
        if (n && strcmp(n, name.c_str()) == 0) {
          present = true;
          break;
        }
      }
      if (!present) {
        Serial.printf("[story_sync] reconciling orphaned bundle into index: %s\n", name.c_str());
        order.add(name);
      }
    }
    storiesRoot.close();
    writeIndex(next);
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
  snprintf(msg, sizeof(msg), "Fetching %s\n%d/%d  %u%%", _bundle, _fileIndex + 1, _fileCount, pct);
  _display->displayText(msg);
  _lastProgressMs = millis();
}

// ── announce intake ─────────────────────────────────────────────────────────

bool StorySync::parseAnnounce(JsonDocument& doc) {
  const char* bundle = doc["bundle"] | "";
  const char* baseUrl = doc["base_url"] | "";
  JsonArray files = doc["files"].as<JsonArray>();
  static_assert(sizeof(_bundle) == StorySyncCore::kMaxBundleLen + 1, "bundle buffer");
  static_assert(MAX_FILES == StorySyncCore::kMaxFiles, "file count limit");
  static_assert(sizeof(FileEntry::name) == StorySyncCore::kMaxNameLen + 1, "file name buffer");
  if (!StorySyncCore::validBundleName(bundle)) {
    sendFailedFor("?", "bad announce: bundle");
    return false;
  }
  StorySyncCore::BaseUrl base;
  if (!StorySyncCore::parseBaseUrl(baseUrl, &base)) {
    sendFailedFor(bundle, "bad announce: base_url");
    return false;
  }
  if (files.isNull() || files.size() == 0 || files.size() > (size_t)MAX_FILES) {
    sendFailedFor(bundle, "bad announce: files");
    return false;
  }
  strlcpy(_bundle, bundle, sizeof(_bundle));
  _base = base;
  _fileCount = 0;
  for (JsonObject f : files) {
    const char* name = f["path"] | "";
    long long size = f["size"] | -1;
    const char* crcHex = f["crc32"] | "";
    if (!StorySyncCore::validFileName(name) || !StorySyncCore::validSize(size) ||
        !StorySyncCore::validCrcHex(crcHex)) {
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
  // The receipt alone is not enough: a manifest can outlive its audio (a
  // partial eviction, a torn write), and `already` would then report a healthy
  // delivery that plays in silence. So check that each clip exists at its
  // declared size. No re-hash: that would read the whole bundle (~2 MB) per
  // announce to catch corruption that finishFile()'s CRC check and the atomic
  // commit already exclude.
  String dir = String("/stories/") + _bundle + "/";
  for (int j = 0; j < _fileCount; j++) {
    File af = LittleFS.open(dir + _files[j].name, "r");
    if (!af) return false;
    uint32_t actual = (uint32_t)af.size();
    af.close();
    if (actual != _files[j].size) return false;
  }
  return true;
}

// ── job lifecycle ───────────────────────────────────────────────────────────

void StorySync::abortFile() {
  if (_out) _out.close();
  _wifi.stop();
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
    // Same bundle re-announced mid-fetch: restart from scratch. Drop the
    // partial copy now, so the space check below counts its bytes as free,
    // and resume the app, so an announce that stops early (bad, already
    // present, no space) cannot leave it paused. startJob() pauses it again.
    endJob();
    removeDirRecursive(String("/stories/") + _bundle + ".tmp");
  }
  if (!parseAnnounce(doc)) return;
  _jobStartMs = millis();
  _totalBytes = 0;
  if (alreadyHave()) {
    pingSentinel();
    sendDone(true);
    return;
  }
  if (!ensureSpace()) return;  // ensureSpace replies with the byte math
  startJob();
}

void StorySync::update() {
  switch (_state) {
    case State::Idle:
      return;
    case State::StartFile:
      if (millis() < _retryAtMs) return;
      startFile();
      return;
    case State::ReadHead:
      readHead();
      return;
    case State::Streaming:
      streamSlice();
      return;
  }
}

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

// Serialize to a temp file first, then rename over the real index — a crash
// mid-write leaves the old index intact instead of a truncated/corrupt one.
static void writeIndex(JsonDocument& doc) {
  LittleFS.remove("/stories/.index.tmp");  // defensive: stale tmp from a prior crash
  File f = LittleFS.open("/stories/.index.tmp", "w");
  if (!f) return;
  serializeJson(doc, f);
  f.close();
  LittleFS.remove("/stories/.index");
  LittleFS.rename("/stories/.index.tmp", "/stories/.index");
}

// The bytes of the files directly inside `dir`. Bundles are flat.
static uint64_t dirBytes(const String& dir) {
  File d = LittleFS.open(dir);
  if (!d || !d.isDirectory()) {
    if (d) d.close();
    return 0;
  }
  uint64_t total = 0;
  for (File e = d.openNextFile(); e; e = d.openNextFile()) {
    if (!e.isDirectory()) total += e.size();
    e.close();
  }
  d.close();
  return total;
}

bool StorySync::ensureSpace() {
  uint64_t need = SPACE_SLACK;
  for (int i = 0; i < _fileCount; i++) need += _files[i].size;
  const uint64_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
  // The bundle being fetched is never evicted: its old copy stays on disk
  // until commitBundle() replaces it, so the new copy must fit beside it.
  // SPACE_SLACK covers filesystem metadata.
  if (freeBytes >= need) return true;

  // Plan first, then delete: an announce that cannot fit even with every
  // other story gone is refused with all of them still on disk.
  JsonDocument idx;
  StorySyncCore::EvictionEntry entries[MAX_INDEX];
  bool evict[MAX_INDEX];
  size_t count = 0;
  if (readIndex(idx)) {
    for (JsonVariant v : idx.as<JsonArray>()) {
      if (count == MAX_INDEX) break;
      const char* name = v.as<const char*>();
      const bool valid = name && StorySyncCore::validBundleName(name);
      entries[count++] = {name, valid ? dirBytes(String("/stories/") + name) : 0};
    }
  }
  if (!StorySyncCore::planEviction(need, freeBytes, entries, count, _bundle, evict)) {
    char reason[96];
    snprintf(reason, sizeof(reason), "no space: need %llu, free %llu, too little to evict",
             (unsigned long long)need, (unsigned long long)freeBytes);
    sendFailed(reason);
    return false;
  }

  JsonDocument next;
  JsonArray keep = next.to<JsonArray>();
  size_t i = 0;
  for (JsonVariant v : idx.as<JsonArray>()) {
    if (i < count && evict[i]) {
      Serial.printf("[story_sync] evicting %s\n", entries[i].name);
      removeDirRecursive(String("/stories/") + entries[i].name);
    } else if (v.is<const char*>()) {
      keep.add(v);
    }
    i++;
  }
  writeIndex(next);

  // The plan counts file bytes, and LittleFS frees whole blocks, so this
  // should hold. Check rather than start a fetch that cannot finish.
  if (LittleFS.totalBytes() - LittleFS.usedBytes() < need) {
    sendFailed("no space after eviction");
    return false;
  }
  return true;
}

// ── per-file fetch ──────────────────────────────────────────────────────────

// One connection per request: "Connection: close", and the old socket is
// closed first, so a request never goes to a previous announce's server.
bool StorySync::sendRequest(const char* name) {
  _wifi.stop();
  char req[StorySyncCore::kMaxRequestLen];
  if (!StorySyncCore::formatGetRequest(_base, name, req, sizeof(req))) return false;
  const IPAddress ip(_base.ip[0], _base.ip[1], _base.ip[2], _base.ip[3]);
  if (!_wifi.connect(ip, _base.port, CONNECT_TIMEOUT_MS)) return false;
  const size_t len = strlen(req);
  return _wifi.write(reinterpret_cast<const uint8_t*>(req), len) == len;
}

// Requests the .already sentinel so the server log stays the skill's
// completion oracle. Telemetry only: the bundle is present either way. It
// waits at most SENTINEL_WAIT_MS for the reply, which only feeds the log.
void StorySync::pingSentinel() {
  if (!sendRequest(".already")) {
    Serial.printf("[story_sync] sentinel unreachable: %u.%u.%u.%u:%u\n", _base.ip[0], _base.ip[1],
                  _base.ip[2], _base.ip[3], _base.port);
    _wifi.stop();
    return;
  }
  StorySyncCore::ResponseHead head;
  const uint32_t start = millis();
  while (millis() - start < SENTINEL_WAIT_MS) {
    const int c = _wifi.read();
    if (c < 0) {
      if (!_wifi.connected()) break;
      delay(1);
      continue;
    }
    if (head.feed(static_cast<char>(c)) != StorySyncCore::ResponseHead::Step::More) break;
  }
  _wifi.stop();
}

void StorySync::startFile() {
  if (_fileIndex >= _fileCount) {
    commitBundle();
    return;
  }
  if (!sendRequest(_files[_fileIndex].name)) {
    retryOrFail("connect failed");
    return;
  }
  _head = StorySyncCore::ResponseHead();
  _fileStartMs = millis();
  _state = State::ReadHead;
}

// Reads what has arrived of the response header. ResponseHead fails past
// kMaxHeadBytes, so one call does a bounded amount of work, and the header
// must be complete within kHeadTimeoutMs however the server paces it.
void StorySync::readHead() {
  for (;;) {
    const int c = _wifi.read();
    if (c < 0) break;
    const auto step = _head.feed(static_cast<char>(c));
    if (step == StorySyncCore::ResponseHead::Step::More) continue;
    if (step == StorySyncCore::ResponseHead::Step::Error) {
      retryOrFail(_head.error());
      return;
    }
    if (_head.status() != 200) {
      char why[24];
      snprintf(why, sizeof(why), "http %d", _head.status());
      retryOrFail(why);
      return;
    }
    String tmpPath = String("/stories/") + _bundle + ".tmp/" + _files[_fileIndex].name;
    _out = LittleFS.open(tmpPath, "w");
    if (!_out) {
      retryOrFail("open failed");
      return;
    }
    _crc = 0;
    _received = 0;
    _lastDataMs = millis();
    _state = State::Streaming;
    showProgress();
    return;
  }
  if (!_wifi.connected()) {
    retryOrFail("connection closed early");
    return;
  }
  if (millis() - _fileStartMs > StorySyncCore::kHeadTimeoutMs) retryOrFail("header timeout");
}

void StorySync::streamSlice() {
  FileEntry& f = _files[_fileIndex];
  uint8_t buf[1024];
  size_t budget = SLICE_BYTES;
  while (budget > 0) {
    int avail = _wifi.available();
    if (avail <= 0) break;
    // Never read past this file's announced size, even if the server sends
    // more than it promised — an oversize response still fails finishFile()'s
    // size check, but it won't overrun the buffer/disk on the way there.
    size_t remaining = f.size > _received ? f.size - _received : 0;
    size_t want = min((size_t)avail, min(budget, min(sizeof(buf), remaining)));
    int n = _wifi.read(buf, want);
    if (n <= 0) break;
    size_t written = _out.write(buf, n);
    if (written != (size_t)n) {
      // Short/failed write: the buffer's contents no longer match what's on
      // disk, so _received/_crc must not advance — retry the whole file.
      retryOrFail("write failed");
      return;
    }
    _crc = esp_rom_crc32_le(_crc, buf, n);
    _received += n;
    budget -= n;
    _lastDataMs = millis();
  }
  if (_received >= f.size) {
    finishFile();
    return;
  }
  if (!_wifi.connected() && _wifi.available() <= 0) {
    retryOrFail("connection closed early");
    return;
  }
  if (millis() - _lastDataMs > STREAM_STALL_MS) {
    retryOrFail("stalled");
    return;
  }
  // A server that sends a byte now and then never stalls, so the file also
  // has a deadline in proportion to its size.
  if (millis() - _fileStartMs > StorySyncCore::fileDeadlineMs(f.size)) {
    retryOrFail("too slow");
    return;
  }
  if (millis() - _lastProgressMs > 500) showProgress();
}

void StorySync::finishFile() {
  FileEntry& f = _files[_fileIndex];
  _out.close();
  _wifi.stop();
  if (_received != f.size) {
    retryOrFail("size mismatch");
    return;
  }
  if (_crc != f.crc32) {
    retryOrFail("crc32 mismatch");
    return;
  }
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
  if (!f) {
    sendFailed("receipt write failed");
    removeDirRecursive(tmp);
    endJob();
    return;
  }
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
      const char* name = v.as<const char*>();
      if (name && strcmp(name, _bundle) != 0) order.add(v);
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
