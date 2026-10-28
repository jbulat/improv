// Every voice an actor can have must have a Kokoro voice, or gen:audio stops
// on the first story that casts it.
import { describe, expect, it } from "vitest";
import { KOKORO_VOICES } from "../tools/gen-line-audio";
import { loadTroupe } from "../tools/lib/troupe";

describe("gen:audio's voice table", () => {
  it("maps every troupe voice to a Kokoro voice, and nothing else", () => {
    const troupeVoices = loadTroupe().voices.map((v) => v.id);
    expect(Object.keys(KOKORO_VOICES).sort()).toEqual([...troupeVoices].sort());
  });
});
