// Host harness for tests/wav-reader.test.ts: runs the firmware's WavReader
// over a file and prints "ok <rate> <dataOffset> <dataBytes>" or "err <name>".
#include "../../device/lib/drivers/src/WavReader.h"

#include <cstdio>
#include <cstring>
#include <vector>

struct BufferReader {
  const uint8_t* buf;
  size_t len;
  size_t pos = 0;
  bool read(void* dst, size_t n) {
    if (n > len - pos) return false;
    memcpy(dst, buf + pos, n);
    pos += n;
    return true;
  }
  bool seek(size_t abs) {
    if (abs > len) return false;
    pos = abs;
    return true;
  }
};

int main(int argc, char** argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s <file.wav>\n", argv[0]);
    return 2;
  }
  FILE* f = fopen(argv[1], "rb");
  if (!f) {
    fprintf(stderr, "cannot open %s\n", argv[1]);
    return 2;
  }
  std::vector<uint8_t> data;
  uint8_t chunk[4096];
  size_t n;
  while ((n = fread(chunk, 1, sizeof(chunk), f)) > 0) data.insert(data.end(), chunk, chunk + n);
  fclose(f);

  BufferReader r{data.data(), data.size()};
  WavReader::Info info = WavReader::parse(r);
  if (!info.ok()) {
    printf("err %s\n", WavReader::errorName(info.error));
    return 0;
  }
  printf("ok %u %u %u\n", (unsigned)info.sampleRate, (unsigned)info.dataOffset,
         (unsigned)info.dataBytes);
  return 0;
}
