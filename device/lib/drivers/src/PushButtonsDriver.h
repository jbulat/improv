// Adapted from the Resident m5stick demo (MIT, Copyright (c) 2026 Inanimate).
// See THIRD_PARTY_NOTICES.md.
#ifndef PUSH_BUTTONS_DRIVER_H
#define PUSH_BUTTONS_DRIVER_H

#include <cstdint>
#include <ResidentDriver.h>
#include <ResidentLuaModule.h>
#include <ResidentSystemButton.h>

struct PushButtonsConfig {
  uint8_t numButtons;
  const uint8_t* pins;
};

// Also acts as the Resident::SystemButton (button 0 — the front button), so the
// runtime can read it directly during the boot countdown (tap = load now, long
// press = forget the saved app), independent of the app-facing button events.
class PushButtonsDriver : public Resident::SystemButton {
 public:
  explicit PushButtonsDriver(const PushButtonsConfig& config);

  const char* name() const override { return "button"; }
  void begin() override;
  void update() override;
  void onAppReset() override;
  void registerModule(Resident::LuaModule& m) override {
    m.method<PushButtonsDriver, &PushButtonsDriver::pressCount>("press_count");
  }

  int pressCount(lua_State* L);

  // Resident::SystemButton. An edge latch, not a level: true from a debounced
  // HIGH->LOW transition until release. Resident's boot countdown reads it
  // while the user presses on screen, which always produces a fresh edge. A
  // button already held when begin() samples the pin never produces an edge;
  // use heldLevel() for that.
  bool pressed() override;

  // Raw, undebounced level: true while button `i` is physically down. For
  // callers that need the current state rather than a transition (the boot
  // skip gesture). Requires begin().
  bool heldLevel(uint8_t i) const;

  uint32_t getTotalPressCount() const;

  using LongPressFn = void (*)(bool started);
  void setLongPress(uint8_t buttonIndex, LongPressFn callback, unsigned long thresholdMs = 200);

 private:
  static constexpr uint8_t MAX_BUTTONS = 4;
  static constexpr unsigned long DEBOUNCE_MS = 50;

  const PushButtonsConfig& _config;

  struct ButtonState {
    bool lastState;
    unsigned long lastDebounceTime;
    uint32_t pressCount;  // presses since the last app reset; must not wrap at 255
    bool isDown;
    unsigned long downStartTime;
    bool longPressTriggered;
  };

  ButtonState _buttons[MAX_BUTTONS];

  struct LongPressConfig {
    LongPressFn callback = nullptr;
    unsigned long thresholdMs = 500;
  };
  LongPressConfig _longPress[MAX_BUTTONS];
};

#endif  // PUSH_BUTTONS_DRIVER_H
