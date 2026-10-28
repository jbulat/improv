#ifndef WAV_READER_H
#define WAV_READER_H

#include <cstddef>
#include <cstdint>

// Dependency-free RIFF/WAVE walk, shared between AudioDriver (fs::File) and
// the host test harness (memory buffer). Locates "fmt " and "data", skipping
// everything else — macOS afconvert emits an "FLLR" padding chunk between
// them, so data cannot be assumed to follow fmt. 16-bit mono PCM only;
// that's what the pipeline produces.
//
// Reader is any type providing:
//   bool read(void* dst, size_t n);   // false on short read
//   bool seek(size_t absOffset);      // false if out of range
namespace WavReader {

enum class Error : uint8_t {
  None,
  NotRiff,            // missing/truncated RIFF/WAVE header
  BadFmt,             // fmt chunk too small or truncated
  UnsupportedFormat,  // not 16-bit mono PCM (see Info fmt fields)
  DataBeforeFmt,      // data chunk seen before fmt
  NoData,             // chunk walk ended without a data chunk
};

inline const char* errorName(Error e) {
  switch (e) {
    case Error::None:
      return "ok";
    case Error::NotRiff:
      return "not-riff";
    case Error::BadFmt:
      return "bad-fmt";
    case Error::UnsupportedFormat:
      return "unsupported-format";
    case Error::DataBeforeFmt:
      return "data-before-fmt";
    case Error::NoData:
      return "no-data";
  }
  return "unknown";
}

struct Info {
  Error error = Error::NoData;
  uint32_t sampleRate = 0;
  uint32_t dataOffset = 0;  // absolute byte offset of the first sample
  uint32_t dataBytes = 0;
  // What fmt declared — populated so UnsupportedFormat can be logged usefully.
  uint16_t audioFormat = 0;
  uint16_t channels = 0;
  uint16_t bits = 0;
  bool ok() const { return error == Error::None; }
};

template <typename Reader>
Info parse(Reader& r) {
  Info info;

  uint8_t hdr[12];
  if (!r.read(hdr, 12) || hdr[0] != 'R' || hdr[1] != 'I' || hdr[2] != 'F' || hdr[3] != 'F' ||
      hdr[8] != 'W' || hdr[9] != 'A' || hdr[10] != 'V' || hdr[11] != 'E') {
    info.error = Error::NotRiff;
    return info;
  }

  uint64_t pos = 12;
  bool fmtOk = false;
  for (;;) {
    uint8_t ch[8];
    if (!r.read(ch, 8)) break;  // clean end of chunk walk
    pos += 8;
    uint32_t size = ch[4] | (ch[5] << 8) | (ch[6] << 16) | ((uint32_t)ch[7] << 24);

    if (ch[0] == 'f' && ch[1] == 'm' && ch[2] == 't' && ch[3] == ' ') {
      uint8_t fmt[16];
      if (size < 16 || !r.read(fmt, 16)) {
        info.error = Error::BadFmt;
        return info;
      }
      pos += 16;
      info.audioFormat = fmt[0] | (fmt[1] << 8);
      info.channels = fmt[2] | (fmt[3] << 8);
      info.sampleRate = fmt[4] | (fmt[5] << 8) | (fmt[6] << 16) | ((uint32_t)fmt[7] << 24);
      info.bits = fmt[14] | (fmt[15] << 8);
      if (info.audioFormat != 1 || info.channels != 1 || info.bits != 16) {
        info.error = Error::UnsupportedFormat;
        return info;
      }
      fmtOk = true;
      pos += (size - 16) + (size & 1);
      if (pos > SIZE_MAX || !r.seek((size_t)pos)) break;
    } else if (ch[0] == 'd' && ch[1] == 'a' && ch[2] == 't' && ch[3] == 'a') {
      if (!fmtOk) {
        info.error = Error::DataBeforeFmt;
        return info;
      }
      info.dataOffset = (uint32_t)pos;
      info.dataBytes = size;
      info.error = Error::None;
      return info;
    } else {
      pos += size + (size & 1);  // skip (FLLR, LIST, ...)
      if (pos > SIZE_MAX || !r.seek((size_t)pos)) break;
    }
  }

  info.error = Error::NoData;
  return info;
}

}  // namespace WavReader

#endif  // WAV_READER_H
