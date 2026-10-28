#ifndef STORY_SYNC_H
#define STORY_SYNC_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFiClient.h>
#include <FS.h>
#include <ResidentExtension.h>

#include "StorySyncCore.h"

class DisplayDriver;
namespace Resident {
class Sandbox;
}

// The ESP32 toolchain's <sys/syslimits.h> #defines NAME_MAX (pulled in
// transitively via limits.h from the Arduino/FreeRTOS headers), which
// mangles the class member of the same name below. Undefine the macro; we
// don't use the libc constant anywhere in this codebase.
#ifdef NAME_MAX
#undef NAME_MAX
#endif

// Over-the-air story delivery. Handles "story_fetch" announces arriving over
// the sandbox WebSocket: pulls each manifest file over HTTP/1.0 into
// /stories/<bundle>.tmp/, verifies size and CRC32 per file, then renames the
// directory over /stories/<bundle>/, the paths AudioDriver reads. Replies
// story_fetch_done or story_fetch_failed. No Lua surface: by the time an app
// is pushed, its audio is in place.
class StorySync : public Resident::Extension {
 public:
  const char* name() const override { return "story_sync"; }

  // Wire once in setup(), after the sandbox exists.
  void attach(Resident::Sandbox* sandbox, DisplayDriver* display) {
    _sandbox = sandbox;
    _display = display;
  }

  // Boot recovery: publishes a leftover /stories/*.tmp that carries a valid
  // receipt (a verified bundle that only lacked its final rename), discards
  // one that doesn't (a cut fetch), then reconciles /stories/.index with the
  // bundles actually on disk so none is left un-evictable.
  void begin() override;
  void update() override;  // fetch state machine; bounded work per tick

  // Called from main.cpp's message hooks for type == "story_fetch".
  void onStoryFetch(JsonDocument& doc);

 private:
  static constexpr int MAX_FILES = 48;
  static constexpr size_t NAME_MAX = 47;            // flat basenames only
  static constexpr size_t SLICE_BYTES = 16 * 1024;  // per-tick read budget
  static constexpr int FILE_RETRIES = 3;
  static constexpr size_t SPACE_SLACK = 64 * 1024;
  static constexpr int MAX_INDEX = 64;  // index entries considered for eviction
  static constexpr int32_t CONNECT_TIMEOUT_MS = 5000;
  static constexpr uint32_t SENTINEL_WAIT_MS = 2000;
  static constexpr uint32_t STREAM_STALL_MS = 10000;

  struct FileEntry {
    char name[NAME_MAX + 1];
    uint32_t size;
    uint32_t crc32;
  };
  enum class State { Idle, StartFile, ReadHead, Streaming };

  // ── job setup ──
  bool parseAnnounce(JsonDocument& doc);  // sanitize into members; replies on error
  bool alreadyHave();                     // /stories/<b>/.manifest.json matches?
  void startJob();                        // suspend app, mk tmp, enter StartFile
  void endJob();                          // resume app, reset to Idle

  // ── fetch engine ──
  bool ensureSpace();  // evict oldest until the job fits, or refuse first
  void startFile();    // send the GET for the next file, or commit
  void readHead();     // read the response header, then open the tmp file
  void streamSlice();  // ≤ SLICE_BYTES per tick
  void finishFile();   // verify size + crc, advance
  void retryOrFail(const char* why);
  void commitBundle();  // write receipt, rename, update index

  // ── plumbing ──
  void sendDone(bool already);
  void sendFailed(const char* reason);
  void sendFailedFor(const char* bundle, const char* reason);
  void showProgress();
  bool sendRequest(const char* name);  // connect and send one GET
  void pingSentinel();                 // GET .already, for the server log
  void abortFile();                    // close the connection + tmp file
  static void removeDirRecursive(const String& dirPath);

  Resident::Sandbox* _sandbox = nullptr;
  DisplayDriver* _display = nullptr;

  State _state = State::Idle;
  char _bundle[41] = {0};
  StorySyncCore::BaseUrl _base{};
  FileEntry _files[MAX_FILES];
  int _fileCount = 0;
  int _fileIndex = 0;
  int _attempt = 0;
  bool _suspendedApp = false;
  uint32_t _jobStartMs = 0;
  uint32_t _totalBytes = 0;
  uint32_t _retryAtMs = 0;

  WiFiClient _wifi;
  StorySyncCore::ResponseHead _head;
  File _out;
  uint32_t _crc = 0;
  uint32_t _received = 0;
  uint32_t _fileStartMs = 0;
  uint32_t _lastDataMs = 0;
  uint32_t _lastProgressMs = 0;
};

#endif  // STORY_SYNC_H
