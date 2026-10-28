#include "AudioDriver.h"
#include "WavReader.h"
#include <M5Unified.h>
#include <LittleFS.h>
#include <cstring>

extern "C" {
#include "lua/lua.h"
#include "lua/lauxlib.h"
}

void AudioDriver::begin() {
  // LittleFS is mounted in main.cpp's setup(), since StorySync and the app
  // store share the same mount.
  M5.Speaker.setVolume(_volume);
  // Narration at full; sfx attenuated so the story track stays in front.
  M5.Speaker.setChannelVolume(NARRATION_CHANNEL, 255);
  M5.Speaker.setChannelVolume(SFX_CHANNEL, SFX_CHANNEL_VOLUME);
}

void AudioDriver::onAppReset() {
  M5.Speaker.stop();  // playRaw reads our buffers: stop before freeing
  freeAll();
}

void AudioDriver::freeAll() {
  for (int i = 0; i < _clipCount; i++) heap_caps_free(_clips[i].samples);
  _clipCount = 0;
  _cacheBytes = 0;
}

AudioDriver::Clip* AudioDriver::find(const char* path) {
  for (int i = 0; i < _clipCount; i++) {
    if (strcmp(_clips[i].path, path) == 0) return &_clips[i];
  }
  return nullptr;
}

// Adapts fs::File to WavReader's reader interface (the RIFF walk itself is in
// WavReader.h, host-tested by tests/wav-reader.test.ts).
namespace {
struct FileReader {
  File& f;
  bool read(void* dst, size_t n) { return f.read((uint8_t*)dst, n) == n; }
  bool seek(size_t abs) { return f.seek(abs); }
};
}  // namespace

AudioDriver::Clip* AudioDriver::load(const char* path) {
  char norm[96];
  int len = snprintf(norm, sizeof(norm), "%s%s", path[0] == '/' ? "" : "/", path);
  if (len < 0 || (size_t)len >= sizeof(norm)) {
    // Truncation would let two long paths alias to the same cache entry.
    Serial.printf("[audio] path too long (%d chars, max %u): %s\n", len,
                  (unsigned)(sizeof(norm) - 1), path);
    return nullptr;
  }
  if (Clip* hit = find(norm)) return hit;
  if (_clipCount >= MAX_CLIPS) {
    Serial.printf("[audio] clip table full (%d), refusing %s\n", MAX_CLIPS, norm);
    return nullptr;
  }

  File f = LittleFS.open(norm, "r");
  if (!f) {
    Serial.printf("[audio] missing file %s\n", norm);
    return nullptr;
  }

  FileReader reader{f};
  WavReader::Info wav = WavReader::parse(reader);
  if (wav.error == WavReader::Error::UnsupportedFormat) {
    Serial.printf("[audio] %s: want 16-bit mono PCM, got fmt=%u ch=%u bits=%u\n", norm,
                  wav.audioFormat, wav.channels, wav.bits);
    return nullptr;
  }
  if (!wav.ok()) {
    Serial.printf("[audio] %s: bad WAV (%s)\n", norm, WavReader::errorName(wav.error));
    return nullptr;
  }

  uint32_t size = wav.dataBytes;
  if (_cacheBytes + size > CACHE_CAP_BYTES) {
    Serial.printf("[audio] cache full: %u + %u > %u, refusing %s\n", (unsigned)_cacheBytes,
                  (unsigned)size, (unsigned)CACHE_CAP_BYTES, norm);
    return nullptr;
  }
  int16_t* buf = (int16_t*)heap_caps_malloc(size, MALLOC_CAP_SPIRAM);
  if (!buf) {
    Serial.printf("[audio] PSRAM alloc of %u failed for %s\n", (unsigned)size, norm);
    return nullptr;
  }
  uint32_t t0 = millis();
  if (!f.seek(wav.dataOffset) || f.read((uint8_t*)buf, size) != size) {
    Serial.printf("[audio] short read on %s\n", norm);
    heap_caps_free(buf);
    return nullptr;
  }
  Clip* c = &_clips[_clipCount++];
  strncpy(c->path, norm, sizeof(c->path) - 1);
  c->path[sizeof(c->path) - 1] = '\0';
  c->samples = buf;
  c->sampleCount = size / 2;
  c->sampleRate = wav.sampleRate;
  _cacheBytes += size;
  Serial.printf("[audio] loaded %s: %u bytes @ %u Hz in %lu ms\n", norm, (unsigned)size,
                (unsigned)wav.sampleRate, millis() - t0);
  return c;
}

// audio.preload(path) -> ok
int AudioDriver::preload(lua_State* L) {
  const char* path = luaL_checkstring(L, 1);
  lua_pushboolean(L, load(path) != nullptr);
  return 1;
}

// audio.play(path [, channel [, offset_ms]]) -> ok
// offset_ms starts playback that many ms into the clip (for in-sync resume).
int AudioDriver::play(lua_State* L) {
  const char* path = luaL_checkstring(L, 1);
  int channel = (int)luaL_optinteger(L, 2, 0);
  if (channel < 0) channel = 0;
  if (channel >= NUM_CHANNELS) channel = NUM_CHANNELS - 1;
  int offsetMs = (int)luaL_optinteger(L, 3, 0);
  if (offsetMs < 0) offsetMs = 0;
  Clip* c = load(path);
  if (!c) {
    lua_pushboolean(L, false);
    return 1;
  }
  size_t offsetSamples = (size_t)((uint64_t)offsetMs * c->sampleRate / 1000);
  if (offsetSamples >= c->sampleCount) {  // clip already elapsed past this point
    lua_pushboolean(L, false);
    return 1;
  }
  bool ok = M5.Speaker.playRaw(c->samples + offsetSamples, c->sampleCount - offsetSamples,
                               c->sampleRate, /*stereo=*/false, /*repeat=*/1, channel,
                               /*stop_current_sound=*/true);
  lua_pushboolean(L, ok);
  return 1;
}

// audio.stop([channel]) — no arg stops every channel
int AudioDriver::stop(lua_State* L) {
  if (lua_gettop(L) >= 1 && !lua_isnil(L, 1)) {
    M5.Speaker.stop((uint8_t)luaL_checkinteger(L, 1));
  } else {
    M5.Speaker.stop();
  }
  return 0;
}

// audio.is_playing([channel]) -> bool
int AudioDriver::isPlaying(lua_State* L) {
  int channel = (int)luaL_optinteger(L, 1, -1);
  bool playing =
      channel < 0 ? M5.Speaker.isPlaying() : (M5.Speaker.isPlaying((uint8_t)channel) != 0);
  lua_pushboolean(L, playing);
  return 1;
}

// audio.set_volume(v) — 0..255, shared with the buzzer (same speaker)
int AudioDriver::setVolume(lua_State* L) {
  int v = (int)luaL_checkinteger(L, 1);
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  M5.Speaker.setVolume((uint8_t)v);
  return 0;
}
