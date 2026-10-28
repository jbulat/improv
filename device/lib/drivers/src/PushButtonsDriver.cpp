// Adapted from the Resident m5stick demo (MIT, Copyright (c) 2026 Inanimate).
// See THIRD_PARTY_NOTICES.md.
#include "PushButtonsDriver.h"
#include <Arduino.h>

extern "C" {
#include "lua/lua.h"
#include "lua/lualib.h"
#include "lua/lauxlib.h"
}

PushButtonsDriver::PushButtonsDriver(const PushButtonsConfig& config) : _config(config) {
  for (uint8_t i = 0; i < MAX_BUTTONS; i++) {
    _buttons[i] = {true, 0, 0, false, 0, false};
  }
}

void PushButtonsDriver::begin() {
  uint8_t n = _config.numButtons;
  if (n > MAX_BUTTONS) n = MAX_BUTTONS;

  for (uint8_t i = 0; i < n; i++) {
    pinMode(_config.pins[i], INPUT_PULLUP);
    bool state = digitalRead(_config.pins[i]);
    _buttons[i] = {state, 0, _buttons[i].pressCount, false, 0, false};
    Serial.printf("PushButton[%d] on GPIO %d\n", i, _config.pins[i]);
  }
}

void PushButtonsDriver::update() {
  uint8_t n = _config.numButtons;
  if (n > MAX_BUTTONS) n = MAX_BUTTONS;

  unsigned long now = millis();

  for (uint8_t i = 0; i < n; i++) {
    bool current = digitalRead(_config.pins[i]);
    auto& btn = _buttons[i];

    // Debounced press detection (HIGH -> LOW). An edge inside the debounce
    // window leaves lastState alone, so it is retried on a later pass and fast
    // taps are not lost; a blip shorter than the window reads as no transition
    // once the level returns.
    if (current == LOW && btn.lastState == HIGH) {
      if (now - btn.lastDebounceTime > DEBOUNCE_MS) {
        btn.lastDebounceTime = now;
        btn.isDown = true;
        btn.downStartTime = now;
        btn.longPressTriggered = false;
        btn.lastState = current;
      }
    }

    // Check long-press threshold while held
    if (btn.isDown && !btn.longPressTriggered && _longPress[i].callback) {
      if (now - btn.downStartTime >= _longPress[i].thresholdMs) {
        btn.longPressTriggered = true;
        _longPress[i].callback(true);
      }
    }

    // Release detection (LOW → HIGH), debounced so contact chatter mid-hold
    // can't momentarily read "released".
    if (current == HIGH && btn.lastState == LOW) {
      if (now - btn.lastDebounceTime > DEBOUNCE_MS) {
        btn.lastDebounceTime = now;
        if (btn.isDown) {
          if (btn.longPressTriggered) {
            if (_longPress[i].callback) {
              _longPress[i].callback(false);
            }
          } else {
            btn.pressCount++;
            Resident::EventField fields[] = {
                {"index", Resident::EventField::INT, {.i = (int)i}},
                {"count", Resident::EventField::INT, {.i = (int)btn.pressCount}}};
            sendEvent("button", fields, 2);
            Serial.printf("PushButton[%d] pressed (count=%lu)\n", i, (unsigned long)btn.pressCount);
          }
          btn.isDown = false;
        }
        btn.lastState = current;
      }
    }
  }
}

bool PushButtonsDriver::pressed() {
  // Edge latch, not a level: update() sets isDown only on a debounced
  // HIGH -> LOW transition (see the declaration, and heldLevel() below).
  return _buttons[0].isDown;
}

bool PushButtonsDriver::heldLevel(uint8_t i) const {
  uint8_t n = _config.numButtons;
  if (n > MAX_BUTTONS) n = MAX_BUTTONS;
  if (i >= n) return false;
  // INPUT_PULLUP (set in begin()): LOW means the contact is closed.
  return digitalRead(_config.pins[i]) == LOW;
}

void PushButtonsDriver::setLongPress(uint8_t buttonIndex, LongPressFn callback,
                                     unsigned long thresholdMs) {
  if (buttonIndex < MAX_BUTTONS) {
    _longPress[buttonIndex].callback = callback;
    _longPress[buttonIndex].thresholdMs = thresholdMs;
  }
}

void PushButtonsDriver::onAppReset() {
  for (uint8_t i = 0; i < MAX_BUTTONS; i++) {
    _buttons[i].pressCount = 0;
    // Don't clear _longPress — those are device config, not app state
  }
}

uint32_t PushButtonsDriver::getTotalPressCount() const {
  uint32_t total = 0;
  uint8_t n = _config.numButtons;
  if (n > MAX_BUTTONS) n = MAX_BUTTONS;
  for (uint8_t i = 0; i < n; i++) {
    total += _buttons[i].pressCount;
  }
  return total;
}

int PushButtonsDriver::pressCount(lua_State* L) {
  lua_pushinteger(L, getTotalPressCount());
  return 1;
}
