// Host harness for tests/app-store.test.ts: drives AppStoreCore over a real
// directory and reports what it did. One command per invocation; `writes`
// counts writeAll calls, which is how the test sees a skipped rewrite.
#include "../../device/lib/drivers/src/AppStoreCore.h"

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

struct DiskFs {
  int writes = 0;

  size_t size(const char* path) {
    std::error_code ec;
    auto n = fs::file_size(path, ec);
    return ec ? 0 : static_cast<size_t>(n);
  }

  bool readChunk(const char* path, size_t off, void* dst, size_t n) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    f.seekg(static_cast<std::streamoff>(off));
    if (!f) return false;
    f.read(static_cast<char*>(dst), static_cast<std::streamsize>(n));
    return static_cast<size_t>(f.gcount()) == n;
  }

  bool writeAll(const char* path, const void* data, size_t len) {
    writes++;
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) return false;
    f.write(static_cast<const char*>(data), static_cast<std::streamsize>(len));
    return static_cast<bool>(f);
  }

  bool rename(const char* from, const char* to) {
    std::error_code ec;
    fs::rename(from, to, ec);
    return !ec;
  }

  bool remove(const char* path) {
    std::error_code ec;
    return fs::remove(path, ec);
  }
};

static std::string readFile(const char* path) {
  std::ifstream f(path, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

int main(int argc, char** argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s <workdir> <save|load|clear|state> [file]\n", argv[0]);
    return 2;
  }
  const std::string dir = argv[1];
  const std::string cmd = argv[2];
  const std::string main_path = dir + "/app.lua";
  const std::string tmp_path = dir + "/app.lua.tmp";

  DiskFs fsys;

  if (cmd == "save") {
    if (argc < 4) return 2;
    const std::string data = readFile(argv[3]);
    const bool ok =
        AppStore::save(fsys, main_path.c_str(), tmp_path.c_str(), data.data(), data.size());
    printf("save %s writes=%d\n", ok ? "ok" : "err", fsys.writes);
    return 0;
  }

  if (cmd == "load") {
    // The adapter's load() is a plain whole-file read; mirror it here so the
    // test sees the bytes AppStoreCore::save committed.
    const size_t n = fsys.size(main_path.c_str());
    if (n == 0) {
      printf("load 0\n");
      return 0;
    }
    std::vector<char> buf(n);
    if (!fsys.readChunk(main_path.c_str(), 0, buf.data(), n)) {
      printf("load err\n");
      return 0;
    }
    if (argc >= 4) {
      std::ofstream out(argv[3], std::ios::binary);
      out.write(buf.data(), static_cast<std::streamsize>(n));
    }
    printf("load %zu\n", n);
    return 0;
  }

  if (cmd == "clear") {
    fsys.remove(main_path.c_str());
    printf("clear ok\n");
    return 0;
  }

  if (cmd == "state") {
    const size_t m = fsys.size(main_path.c_str());
    const size_t t = fsys.size(tmp_path.c_str());
    printf("state main=%zu tmp=%zu\n", m, t);
    return 0;
  }

  fprintf(stderr, "unknown command %s\n", cmd.c_str());
  return 2;
}
