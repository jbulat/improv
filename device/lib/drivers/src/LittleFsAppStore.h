#ifndef LITTLEFS_APP_STORE_H
#define LITTLEFS_APP_STORE_H

#include <Arduino.h>
#include <LittleFS.h>
#include <ResidentPersistentStore.h>

#include <cstring>

#include "AppStoreCore.h"

// The last successfully loaded Lua app, stored on LittleFS.
//
// Resident's default store is NVS, and the nvs partition is 0x5000 (20,480 B),
// shared with WiFiManager's credentials. Story apps are tens of KB, and a
// failed save there is silent: the push succeeds and the story plays, but the
// next power cycle forgets it.
//
// The file sits at /app.lua, outside /stories, so StorySync's directory scan
// and its eviction pass never see it. Resident calls begin() only on the NVS
// store it constructs itself, so nothing here depends on begin(); main.cpp
// mounts LittleFS.
class LittleFsAppStore : public Resident::PersistentStore {
 public:
  bool save(const char* source, size_t len) override {
    LittleFsIo io;
    return AppStore::save(io, PATH, TMP_PATH, source, len);
  }

  String load() override {
    File f = LittleFS.open(PATH, "r");
    if (!f) return String();
    const size_t n = f.size();
    if (n == 0) {
      f.close();
      return String();
    }
    // Read in COMPARE_CHUNK windows: File::read() one byte at a time costs a
    // full fs::File -> VFS -> lfs_file_read call per byte (~33,000 for a 33 KB
    // app) on the cold-boot path. Reading straight into the String, not via a
    // full-size scratch buffer, keeps one copy live while Resident holds its
    // own _pendingPersistedSource copy.
    String out;
    if (!out.reserve(n)) {
      f.close();
      return String();
    }
    char chunk[AppStore::COMPARE_CHUNK];
    size_t off = 0;
    while (off < n) {
      const size_t want = (n - off < sizeof(chunk)) ? (n - off) : sizeof(chunk);
      const size_t got = f.read(reinterpret_cast<uint8_t*>(chunk), want);
      if (got == 0) break;  // short read; the length check below rejects it
      if (!out.concat(chunk, static_cast<unsigned int>(got))) {
        f.close();
        return String();
      }
      off += got;
    }
    f.close();
    // A truncated read or a failed grow is never returned as the app.
    if (out.length() != n) return String();
    return out;
  }

  void clear() override { LittleFS.remove(PATH); }

 private:
  static constexpr const char* PATH = "/app.lua";
  static constexpr const char* TMP_PATH = "/app.lua.tmp";

  // The AppStoreCore Fs concept, over LittleFS. sameContent() runs in full on
  // every boot (see AppStore::save), so consecutive size()/readChunk() calls on
  // the same path share one cached open File: one open per pass, not ~66.
  //
  // writeAll, rename and remove close the cached handle first, so an open read
  // handle never coexists with a write, rename or delete of any path. The
  // destructor closes whatever is left; each LittleFsIo lives inside one
  // save() call.
  struct LittleFsIo {
    size_t size(const char* path) {
      File& f = openForRead(path);
      if (!f) return 0;
      return f.size();
    }

    bool readChunk(const char* path, size_t off, void* dst, size_t n) {
      File& f = openForRead(path);
      if (!f) return false;
      if (!f.seek(off)) return false;
      const size_t got = f.read(static_cast<uint8_t*>(dst), n);
      return got == n;
    }

    bool writeAll(const char* path, const void* data, size_t len) {
      closeCached();  // never hold a read handle open while writing
      File f = LittleFS.open(path, "w");
      if (!f) return false;
      const size_t wrote = f.write(static_cast<const uint8_t*>(data), len);
      f.flush();
      f.close();
      return wrote == len;
    }

    bool rename(const char* from, const char* to) {
      closeCached();  // never rename a file out from under an open handle
      return LittleFS.rename(from, to);
    }

    bool remove(const char* path) {
      closeCached();  // never delete a file out from under an open handle
      return LittleFS.remove(path);
    }

    ~LittleFsIo() { closeCached(); }

   private:
    File cachedFile_;
    const char* cachedPath_ = nullptr;

    // Returns the open handle when it is for the same path, else reopens.
    // Paths are compared with strcmp, not by pointer, so this does not rely on
    // callers passing only the PATH and TMP_PATH literals.
    File& openForRead(const char* path) {
      if (cachedFile_ && cachedPath_ && strcmp(cachedPath_, path) == 0) {
        return cachedFile_;
      }
      closeCached();
      cachedFile_ = LittleFS.open(path, "r");
      if (cachedFile_) cachedPath_ = path;
      return cachedFile_;
    }

    void closeCached() {
      if (cachedFile_) cachedFile_.close();
      cachedPath_ = nullptr;
    }
  };
};

#endif  // LITTLEFS_APP_STORE_H
