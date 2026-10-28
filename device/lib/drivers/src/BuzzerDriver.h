// Adapted from the Resident m5stick demo (MIT, Copyright (c) 2026 Inanimate).
// See THIRD_PARTY_NOTICES.md.
#ifndef BUZZER_DRIVER_H
#define BUZZER_DRIVER_H

#include <cstdint>
#include <ResidentDriver.h>
#include <ResidentLuaModule.h>

// Resident driver for buzzer via M5Unified Speaker API.
// Lua API: buzzer.beep(freq_hz, duration_ms)
//          buzzer.tone(freq_hz)  — continuous until stop
//          buzzer.stop()
// Master volume is owned by AudioDriver (same physical speaker) — the buzzer
// deliberately has no volume state of its own.
class BuzzerDriver : public Resident::Driver {
 public:
  const char* name() const override { return "buzzer"; }
  void onAppReset() override;
  void registerModule(Resident::LuaModule& m) override {
    m.method<BuzzerDriver, &BuzzerDriver::beep>("beep")
        .method<BuzzerDriver, &BuzzerDriver::tone>("tone")
        .method<BuzzerDriver, &BuzzerDriver::stop>("stop");
  }

  int beep(lua_State* L);
  int tone(lua_State* L);
  int stop(lua_State* L);
};

#endif  // BUZZER_DRIVER_H
