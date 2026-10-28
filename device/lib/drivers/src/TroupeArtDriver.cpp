#include "TroupeArtDriver.h"
#include "TroupeArtData.h"
#include <cstring>

extern "C" {
#include "lua/lua.h"
#include "lua/lauxlib.h"
}

// Load-and-run one stored chunk; on success its result table is at the top
// of the stack. On failure the Lua error message is at the top.
static bool runChunk(lua_State* L, const char* chunk, const char* chunkName) {
  if (luaL_loadbuffer(L, chunk, strlen(chunk), chunkName) != 0) return false;
  return lua_pcall(L, 0, 1, 0) == 0;
}

// troupe.install(S, { "ada", ... })
int TroupeArtDriver::install(lua_State* L) {
  luaL_checktype(L, 1, LUA_TTABLE);  // S
  luaL_checktype(L, 2, LUA_TTABLE);  // array of actor ids

  if (!runChunk(L, troupe_art::kPaletteChunk, "troupe.palette")) {
    return luaL_error(L, "troupe.install: palette chunk failed: %s", lua_tostring(L, -1));
  }
  lua_setfield(L, 1, "palette");

  lua_newtable(L);
  lua_setfield(L, 1, "sprites");
  lua_getfield(L, 1, "sprites");
  const int spritesIdx = lua_gettop(L);

  for (int i = 1;; i++) {
    lua_rawgeti(L, 2, i);
    if (lua_isnil(L, -1)) {
      lua_pop(L, 1);
      break;
    }
    const char* id = lua_tostring(L, -1);
    if (!id) return luaL_error(L, "troupe.install: ids[%d] is not a string", i);
    const troupe_art::ActorChunk* found = nullptr;
    for (size_t k = 0; k < troupe_art::kActorCount; k++) {
      if (strcmp(troupe_art::kActors[k].id, id) == 0) {
        found = &troupe_art::kActors[k];
        break;
      }
    }
    if (!found) return luaL_error(L, "troupe.install: unknown actor '%s'", id);
    if (!runChunk(L, found->chunk, id)) {
      return luaL_error(L, "troupe.install: chunk '%s' failed: %s", id, lua_tostring(L, -1));
    }
    lua_setfield(L, spritesIdx, id);  // pops the chunk's table
    lua_pop(L, 1);                    // pops the id string
  }
  lua_pop(L, 1);  // pops the sprites table
  return 0;
}

// troupe.fingerprint() -> "xxxxxxxx"
int TroupeArtDriver::fingerprint(lua_State* L) {
  lua_pushstring(L, troupe_art::kFingerprintHex);
  return 1;
}
