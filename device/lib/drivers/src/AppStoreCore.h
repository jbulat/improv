#ifndef APP_STORE_CORE_H
#define APP_STORE_CORE_H

#include <cstddef>
#include <cstring>

// Dependency-free persistence rules for the last-loaded Lua app, shared by
// LittleFsAppStore (LittleFS) and the host test harness (a std::filesystem
// fake). Like WavReader.h, it stays apart from Arduino so it can be compiled
// and tested on a host.
//
// Fs is any type providing:
//   size_t size(const char* path);                              // 0 when absent
//   bool   readChunk(const char* path, size_t off, void* dst, size_t n);
//   bool   writeAll(const char* path, const void* data, size_t len);
//   bool   rename(const char* from, const char* to);
//   bool   remove(const char* path);
namespace AppStore {

// Stack-allocated compare window. Kept small deliberately: this runs on the
// Arduino loop task, and the whole app (tens of KB) must never be buffered.
inline constexpr size_t COMPARE_CHUNK = 512;

// True when `path` already holds exactly these bytes. Size is checked first
// so the common "different story" case costs one stat.
template <typename Fs>
bool sameContent(Fs& fs, const char* path, const char* data, size_t len) {
  if (fs.size(path) != len) return false;
  char buf[COMPARE_CHUNK];
  size_t off = 0;
  while (off < len) {
    const size_t n = (len - off < COMPARE_CHUNK) ? (len - off) : COMPARE_CHUNK;
    if (!fs.readChunk(path, off, buf, n)) return false;
    if (memcmp(buf, data + off, n) != 0) return false;
    off += n;
  }
  return true;
}

// Write `data` to `path` atomically via `tmpPath`.
//
// Identical content is a no-op returning true: Sandbox::loadApp always
// persists, so the boot restore re-enters this on every power-on, and the
// skip saves rewriting tens of KB each time.
//
// LittleFS.rename refuses an existing destination, so the old file is removed
// first. A power cut in that window loses the saved app but never leaves a
// truncated one, which would fail to compile and strand the device on the
// identity screen.
template <typename Fs>
bool save(Fs& fs, const char* path, const char* tmpPath, const char* data, size_t len) {
  if (data == nullptr || len == 0) return false;
  if (sameContent(fs, path, data, len)) return true;

  fs.remove(tmpPath);  // a stale tmp from an interrupted save must not survive
  if (!fs.writeAll(tmpPath, data, len)) {
    fs.remove(tmpPath);
    return false;
  }
  fs.remove(path);
  if (!fs.rename(tmpPath, path)) {
    fs.remove(tmpPath);
    return false;
  }
  return true;
}

}  // namespace AppStore

#endif  // APP_STORE_CORE_H
