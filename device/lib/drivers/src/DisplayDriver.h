// Adapted from the Resident m5stick demo (MIT, Copyright (c) 2026 Inanimate).
// See THIRD_PARTY_NOTICES.md.
#ifndef DISPLAY_DRIVER_H
#define DISPLAY_DRIVER_H

#include <ResidentDriver.h>
#include <ResidentLuaModule.h>
#include <ResidentStatusDisplay.h>
#include <M5Unified.h>

// A SystemDisplay (which is a Driver): Lua screen.* calls and Resident's
// status text both draw into one off-screen sprite. Status text is ignored
// while an app is running.
class DisplayDriver : public Resident::SystemDisplay {
 public:
  const char* name() const override { return "screen"; }

  void registerModule(Resident::LuaModule& m) override {
    m.method<DisplayDriver, &DisplayDriver::clear>("clear")
        .method<DisplayDriver, &DisplayDriver::text>("text")
        .method<DisplayDriver, &DisplayDriver::fillRect>("fill_rect")
        .method<DisplayDriver, &DisplayDriver::rect>("rect")
        .method<DisplayDriver, &DisplayDriver::line>("line")
        .method<DisplayDriver, &DisplayDriver::triangle>("triangle")
        .method<DisplayDriver, &DisplayDriver::fillTriangle>("fill_triangle")
        .method<DisplayDriver, &DisplayDriver::pixel>("pixel")
        .method<DisplayDriver, &DisplayDriver::flip>("flip")
        .method<DisplayDriver, &DisplayDriver::setBrightness>("set_brightness")
        .method<DisplayDriver, &DisplayDriver::width>("width")
        .method<DisplayDriver, &DisplayDriver::height>("height");
#ifdef HAS_QRCODE
    m.method<DisplayDriver, &DisplayDriver::qr>("qr");
#endif
  }

  void onAppReset() override;
  void onAppRunning(bool running) override { _appRunning = running; }

  // Resident::StatusDisplay: draws the text into the sprite and pushes it in
  // one transfer, so frequent updates do not flicker.
  void displayText(const char* text) override;

  // Call once after M5.begin() to create the sprite framebuffer
  void begin() override;

  // Re-pushes the current off-screen sprite to the display without redrawing
  // it. Nothing in this firmware calls it.
  void repaint();

 protected:
  M5Canvas _canvas{&M5.Display};

 private:
  bool _spriteReady = false;
  bool _appRunning = false;

  int clear(lua_State* L);
  int text(lua_State* L);
  int fillRect(lua_State* L);
  int rect(lua_State* L);
  int line(lua_State* L);
  int triangle(lua_State* L);
  int fillTriangle(lua_State* L);
  int pixel(lua_State* L);
  int flip(lua_State* L);
  int setBrightness(lua_State* L);
  int width(lua_State* L);
  int height(lua_State* L);
#ifdef HAS_QRCODE
  int qr(lua_State* L);
#endif
};

#endif  // DISPLAY_DRIVER_H
