#ifndef AUDIO_DRIVER_H
#define AUDIO_DRIVER_H

#include <cstddef>
#include <cstdint>
#include <ResidentDriver.h>
#include <ResidentLuaModule.h>

// Resident driver exposing WAV playback from LittleFS to Lua.
// Lua API: audio.preload(path) -> ok      cache a clip in PSRAM
//          audio.play(path[, ch[, offset_ms]]) -> ok
//                                          ch 0..1 (default 0); loads if uncached;
//                                          offset_ms starts playback that far into
//                                          the clip (default 0), for in-sync resume
//          audio.stop([ch])               no arg: stop every channel
//          audio.is_playing([ch]) -> bool
//          audio.set_volume(v)            0..255 — THE master volume; the buzzer
//                                          shares the speaker and has no volume
//                                          state of its own
// Clips live in a PSRAM cache until the next app load. M5.Speaker.playRaw
// reads from the cached buffer without copying, so the cache owns clip
// lifetime; onAppReset stops playback before freeing.
class AudioDriver : public Resident::Driver {
 public:
  static constexpr int NUM_CHANNELS = 2;
  static constexpr size_t CACHE_CAP_BYTES = 6 * 1024 * 1024;
  static constexpr int MAX_CLIPS = 64;

  // Channel assignment (must match audio.lua): 0 = narration, 1 = sfx.
  static constexpr uint8_t NARRATION_CHANNEL = 0;
  static constexpr uint8_t SFX_CHANNEL = 1;
  // sfx sit under the voice: 40% of full so they colour the scene without
  // covering narration. Channel volume scales beneath the master volume, so
  // audio.set_volume() keeps this ratio intact.
  static constexpr uint8_t SFX_CHANNEL_VOLUME = 255 * 40 / 100;  // 102

  explicit AudioDriver(uint8_t volume = 255) : _volume(volume) {}

  const char* name() const override { return "audio"; }
  void begin() override;
  void onAppReset() override;
  void registerModule(Resident::LuaModule& m) override {
    m.method<AudioDriver, &AudioDriver::preload>("preload")
        .method<AudioDriver, &AudioDriver::play>("play")
        .method<AudioDriver, &AudioDriver::stop>("stop")
        .method<AudioDriver, &AudioDriver::isPlaying>("is_playing")
        .method<AudioDriver, &AudioDriver::setVolume>("set_volume");
  }

  int preload(lua_State* L);
  int play(lua_State* L);
  int stop(lua_State* L);
  int isPlaying(lua_State* L);
  int setVolume(lua_State* L);

 private:
  struct Clip {
    char path[96];
    int16_t* samples;  // PSRAM
    size_t sampleCount;
    uint32_t sampleRate;
  };

  Clip* find(const char* path);
  Clip* load(const char* path);  // nullptr on any failure (logged to serial)
  void freeAll();

  Clip _clips[MAX_CLIPS];
  int _clipCount = 0;
  size_t _cacheBytes = 0;
  uint8_t _volume;
};

#endif  // AUDIO_DRIVER_H
