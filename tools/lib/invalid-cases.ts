import type { Performance } from "./types";

export interface InvalidCase {
  name: string;
  code: string; // the validator error code this mutation must trip
  mutate: (p: Performance) => void;
}

// One named mutation per validator rule. gen-invalid-fixtures writes each to
// fixtures/invalid/<name>.json; some mutations trip secondary errors too, so
// tests assert the expected code is among the errors.
export const INVALID_CASES: InvalidCase[] = [
  {
    name: "bad-shape-missing-cast",
    code: "SHAPE",
    mutate: (p) => {
      delete (p as Partial<Performance>).cast;
    },
  },
  {
    name: "bad-unknown-character",
    code: "UNKNOWN_CHARACTER",
    mutate: (p) => {
      p.timeline[1].character_id = "ghost";
    },
  },
  {
    name: "bad-unknown-actor",
    code: "UNKNOWN_ACTOR",
    mutate: (p) => {
      p.cast[1].actor = "gerald";
    },
  },
  {
    name: "bad-missing-miss-moon",
    code: "MISS_MOON_MISSING",
    mutate: (p) => {
      p.cast.splice(0, 1);
      p.timeline[0].character_id = "hero";
      p.timeline[0].expression = "happy";
    },
  },
  {
    name: "bad-moon-cast-in-role",
    code: "MISS_MOON_MISCAST",
    mutate: (p) => {
      p.cast[1].actor = "miss_moon"; // also trips ACTOR_DOUBLED — fine
    },
  },
  {
    name: "bad-actor-doubled",
    code: "ACTOR_DOUBLED",
    mutate: (p) => {
      p.cast.push({
        character_id: "villain",
        display_name: "The Villain",
        actor: "milo",
        voice: "tts_mid_earnest",
        default_expression: "neutral",
      });
    },
  },
  {
    name: "bad-duplicate-character",
    code: "DUPLICATE_CHARACTER",
    mutate: (p) => {
      p.cast.push({
        character_id: "hero", // same role id twice (also doubles milo)
        display_name: "The Hero Again",
        actor: "milo",
        voice: "tts_mid_earnest",
        default_expression: "neutral",
      });
    },
  },
  {
    name: "bad-expression-for-actor",
    code: "BAD_EXPRESSION",
    mutate: (p) => {
      p.timeline[1].expression = "delighted"; // Miss Moon-only expression on milo
    },
  },
  {
    name: "bad-audio-ref",
    code: "BAD_AUDIO_REF",
    mutate: (p) => {
      p.timeline[0].line_audio = "aud_999";
    },
  },
  {
    name: "bad-audio-kind",
    code: "BAD_AUDIO_KIND",
    mutate: (p) => {
      p.timeline[0].line_audio = "sfx_chime"; // sfx asset used as a line
    },
  },
  {
    name: "bad-speak-without-audio",
    code: "SPEAK_WITHOUT_AUDIO",
    mutate: (p) => {
      p.timeline[0].line_audio = null; // animation stays "speak"
    },
  },
  {
    name: "bad-noncontiguous-index",
    code: "BAD_INDEX",
    mutate: (p) => {
      p.timeline[1].index = 5;
    },
  },
  {
    name: "bad-sfx-past-end",
    code: "SFX_PAST_END",
    mutate: (p) => {
      p.timeline[1].sfx[0].at_ms = 99999;
    },
  },
  {
    name: "bad-unknown-device",
    code: "UNKNOWN_DEVICE",
    mutate: (p) => {
      p.timeline[0].device = "d9";
    },
  },
  {
    name: "bad-voice-not-actor-signature",
    code: "VOICE_NOT_SIGNATURE",
    mutate: (p) => {
      p.cast[1].voice = "tts_low_rumble"; // milo speaking with Tuk's voice
    },
  },
  {
    name: "bad-unknown-layer",
    code: "UNKNOWN_LAYER",
    mutate: (p) => {
      p.cast[1].layers = { headwear: "propeller_beanie" };
    },
  },
  {
    name: "bad-layer-misfit",
    code: "LAYER_MISFIT",
    mutate: (p) => {
      p.cast[1].layers = { headwear: "horns" }; // horns fit tuk; the hero is milo
    },
  },
  {
    name: "bad-beat-layer-misfit",
    code: "LAYER_MISFIT",
    mutate: (p) => {
      // A beat's override wears the same rules as a costume: this beat's
      // speaker is the hero (milo), and horns fit tuk alone.
      p.timeline[1].layers = { headwear: "horns" };
    },
  },
  {
    name: "bad-back-prop-misfit",
    code: "LAYER_MISFIT",
    mutate: (p) => {
      // wings fit pip, rosa, milo and ada; the hero is milo, so cast the
      // dragon's actor instead. tuk wore wings until the butterfly rework
      // took them off him, which is exactly the regression worth pinning.
      p.cast[1].actor = "tuk";
      p.cast[1].layers = { back_prop: "wings" };
    },
  },
  {
    name: "bad-sfx-not-in-vocabulary",
    code: "SFX_NOT_IN_VOCABULARY",
    mutate: (p) => {
      p.assets.audio.push({
        id: "sfx_kazoo",
        kind: "sfx",
        uri: "audio/sfx_kazoo.wav",
        format: "wav",
        duration_ms: 500,
      });
      p.timeline[1].sfx.push({ audio: "sfx_kazoo", at_ms: 200 });
    },
  },
  {
    name: "bad-duplicate-audio-id",
    code: "DUPLICATE_AUDIO_ID",
    mutate: (p) => {
      p.assets.audio.push({ ...p.assets.audio[0], uri: "audio/aud_000b.wav" });
    },
  },
  {
    name: "bad-audio-uri-outside-bundle",
    code: "AUDIO_URI_OUTSIDE_BUNDLE",
    mutate: (p) => {
      p.assets.audio[0].uri = "../../elsewhere/aud_000.wav";
    },
  },
  {
    name: "bad-sfx-out-of-order",
    code: "SFX_OUT_OF_ORDER",
    mutate: (p) => {
      p.timeline[1].sfx = [
        { audio: "sfx_chime", at_ms: 500 },
        { audio: "sfx_chime", at_ms: 100 },
      ];
    },
  },
];
