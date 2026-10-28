#ifndef STORY_SYNC_CORE_H
#define STORY_SYNC_CORE_H

#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

// The rules StorySync applies to a story_fetch announce. Kept dependency-free,
// like AppStoreCore.h, so tests/story-sync-core.test.ts can compile and run
// them on a host against tests/story-sync-cases.json.
namespace StorySyncCore {

inline constexpr size_t kMaxBundleLen = 40;  // kebab-case fixture names
inline constexpr size_t kMaxNameLen = 47;    // flat WAV basenames
inline constexpr size_t kMaxFiles = 48;
inline constexpr size_t kMaxBaseUrlLen = 158;

// 1..kMaxBundleLen characters of [a-z0-9-]. A bundle name becomes a directory
// under /stories, so nothing else is accepted.
inline bool validBundleName(const char* s) {
  const size_t n = strlen(s);
  if (n == 0 || n > kMaxBundleLen) return false;
  for (size_t i = 0; i < n; i++) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    if (!(islower(c) || isdigit(c) || c == '-')) return false;
  }
  return true;
}

// A flat ".wav" basename of 5..kMaxNameLen characters from [A-Za-z0-9._-],
// not starting with '.'. With no '/' or '\' allowed, a manifest entry can only
// name a file directly inside its bundle directory.
inline bool validFileName(const char* s) {
  const size_t n = strlen(s);
  if (n < 5 || n > kMaxNameLen) return false;
  if (s[0] == '.') return false;
  if (strcmp(s + n - 4, ".wav") != 0) return false;
  for (size_t i = 0; i < n; i++) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    if (!(isalnum(c) || c == '.' || c == '_' || c == '-')) return false;
  }
  return true;
}

// Exactly 8 lowercase hex digits. strtoul alone would turn "zzzzzzzz" into 0.
inline bool validCrcHex(const char* s) {
  if (strlen(s) != 8) return false;
  for (int i = 0; i < 8; i++) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    if (!(isdigit(c) || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

// A byte count that fits uint32_t. Checked before narrowing, so a huge value
// cannot wrap to a small one.
inline bool validSize(long long n) { return n > 0 && n <= 0xffffffffLL; }

// The server every file is fetched from: a parsed base_url.
struct BaseUrl {
  uint8_t ip[4];
  uint16_t port;
  char path[kMaxBaseUrlLen + 2];  // starts and ends with '/'
};

// 10/8, 172.16/12 and 192.168/16: the device fetches only from its own LAN.
inline bool isPrivateIPv4(const uint8_t ip[4]) {
  return ip[0] == 10 || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) ||
         (ip[0] == 192 && ip[1] == 168);
}

// Reads up to `maxDigits` decimal digits into `out`. False when there are
// none, or more than `maxDigits`.
inline bool readNumber(const char*& p, int maxDigits, unsigned long& out) {
  int digits = 0;
  out = 0;
  while (isdigit(static_cast<unsigned char>(*p))) {
    if (++digits > maxDigits) return false;
    out = out * 10 + static_cast<unsigned long>(*p - '0');
    p++;
  }
  return digits > 0;
}

// "http://" + a private IPv4 address + an optional ":port" + an optional path
// of [A-Za-z0-9._~/-], at most kMaxBaseUrlLen characters. No host names, no
// user info, no query, no '%' and no spaces or control characters: the parts
// go into the request line as they are, so nothing else may reach it.
inline bool parseBaseUrl(const char* s, BaseUrl* out) {
  if (strlen(s) > kMaxBaseUrlLen || strncmp(s, "http://", 7) != 0) return false;
  const char* p = s + 7;
  BaseUrl u{};
  for (int i = 0; i < 4; i++) {
    if (i > 0 && *p++ != '.') return false;
    unsigned long octet;
    if (!readNumber(p, 3, octet) || octet > 255) return false;
    u.ip[i] = static_cast<uint8_t>(octet);
  }
  if (!isPrivateIPv4(u.ip)) return false;
  u.port = 80;
  if (*p == ':') {
    p++;
    unsigned long port;
    if (!readNumber(p, 5, port) || port == 0 || port > 65535) return false;
    u.port = static_cast<uint16_t>(port);
  }
  if (*p != '\0' && *p != '/') return false;
  size_t n = 0;
  if (*p == '\0') u.path[n++] = '/';
  for (; *p; p++) {
    const unsigned char c = static_cast<unsigned char>(*p);
    if (!(isalnum(c) || c == '.' || c == '_' || c == '~' || c == '/' || c == '-')) return false;
    u.path[n++] = static_cast<char>(c);
  }
  if (u.path[n - 1] != '/') u.path[n++] = '/';
  u.path[n] = '\0';
  if (out) *out = u;
  return true;
}

inline bool validBaseUrl(const char* s) { return parseBaseUrl(s, nullptr); }

// ── fetching one file ──
// StorySync speaks HTTP/1.0 itself rather than through HTTPClient, whose
// header read blocks the main loop for as long as a server keeps sending.

inline constexpr size_t kMaxRequestLen = kMaxBaseUrlLen + kMaxNameLen + 96;
inline constexpr size_t kMaxHeadBytes = 2048;
inline constexpr uint32_t kHeadTimeoutMs = 10000;
inline constexpr uint32_t kMinBytesPerSecond = 4096;

// "GET <path><name> HTTP/1.0" with Host and "Connection: close", so each file
// is one connection. False if it does not fit in `cap`.
inline bool formatGetRequest(const BaseUrl& u, const char* name, char* out, size_t cap) {
  const int n =
      snprintf(out, cap, "GET %s%s HTTP/1.0\r\nHost: %u.%u.%u.%u:%u\r\nConnection: close\r\n\r\n",
               u.path, name, u.ip[0], u.ip[1], u.ip[2], u.ip[3], u.port);
  return n > 0 && static_cast<size_t>(n) < cap;
}

// The time one file may take, from the request to its last byte: the header
// timeout plus one second per kMinBytesPerSecond. A server that trickles bytes
// fast enough to dodge the stall check still runs out of time.
inline uint32_t fileDeadlineMs(uint32_t size) {
  return kHeadTimeoutMs + static_cast<uint32_t>(uint64_t(size) * 1000 / kMinBytesPerSecond);
}

// Reads a response header one byte at a time. Done once the first empty line
// arrives; Error for a status line that is not "HTTP/1.x NNN" or a header over
// kMaxHeadBytes. The bytes after Done are the body.
class ResponseHead {
 public:
  enum class Step { More, Done, Error };

  Step feed(char c) {
    if (++_bytes > kMaxHeadBytes) return fail("header too long");
    if (c == '\r') return Step::More;
    if (c != '\n') {
      if (_status < 0 && _lineLen < sizeof(_first) - 1) _first[_lineLen] = c;
      _lineLen++;
      return Step::More;
    }
    if (_status < 0) {
      _first[_lineLen < sizeof(_first) - 1 ? _lineLen : sizeof(_first) - 1] = '\0';
      _status = statusOf(_first);
      if (_status < 0) return fail("bad status line");
    } else if (_lineLen == 0) {
      return Step::Done;
    }
    _lineLen = 0;
    return Step::More;
  }

  int status() const { return _status; }
  const char* error() const { return _error; }

 private:
  // "HTTP/1.x NNN", then the end or a space.
  static int statusOf(const char* line) {
    if (strncmp(line, "HTTP/1.", 7) != 0 || !isdigit(static_cast<unsigned char>(line[7])) ||
        line[8] != ' ')
      return -1;
    int code = 0;
    for (int i = 9; i < 12; i++) {
      if (!isdigit(static_cast<unsigned char>(line[i]))) return -1;
      code = code * 10 + (line[i] - '0');
    }
    return line[12] == '\0' || line[12] == ' ' ? code : -1;
  }

  Step fail(const char* why) {
    _error = why;
    return Step::Error;
  }

  size_t _bytes = 0;
  size_t _lineLen = 0;
  int _status = -1;
  char _first[16] = {0};
  const char* _error = "";
};

// ── making room ──

struct EvictionEntry {
  const char* name;  // a /stories/.index entry, oldest first
  uint64_t bytes;    // the bundle's size on disk
};

// Chooses, oldest first, the bundles to evict so `need` bytes fit, and sets
// evict[i] for each. Never chooses `current` or a name that is not a bundle
// name. When even every candidate would not make room it chooses nothing and
// returns false, so a story that can never fit deletes no other story.
inline bool planEviction(uint64_t need, uint64_t freeBytes, const EvictionEntry* entries,
                         size_t count, const char* current, bool* evict) {
  for (size_t i = 0; i < count; i++) evict[i] = false;
  uint64_t room = freeBytes;
  for (size_t i = 0; i < count && room < need; i++) {
    const char* name = entries[i].name;
    if (!name || !validBundleName(name) || strcmp(name, current) == 0) continue;
    evict[i] = true;
    room += entries[i].bytes;
  }
  if (room >= need) return true;
  for (size_t i = 0; i < count; i++) evict[i] = false;
  return false;
}

}  // namespace StorySyncCore

#endif  // STORY_SYNC_CORE_H
