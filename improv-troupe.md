# Improv — The Troupe

The fixed casting catalog the **Direct** stage casts against. Six recurring actors with persistent identities play every role in every story via expression, costume, and prop — like a small repertory theatre company. The comedy and the consistency both come from the same actor showing up as a knight in one story and a villain in the next.

This is the catalog; `improv-design.md` is the pipeline and data model.

---

## The six actors

| id | name | category | build / silhouette | base palette (for contrast) | signature |
|---|---|---|---|---|---|
| `bruno` | Bruno | human | broad, stocky | warm orange-brown | beard, wide shoulders |
| `milo`  | Milo  | human | tall, lean | cool blue + ginger hair | height, bright hair |
| `ada`   | Ada   | human | medium, upright | deep purple + dark | rounded coiled-hair shape |
| `rosa`  | Rosa  | human | small, short | light green + blond hair | small stature, long blond hair |
| `pip`   | Pip   | animal | small quadruped | yellow-tan | pointy ears, small |
| `tuk`   | Tuk   | animal | large front-facing beast — horns, neck, tail | red-brown / grey | big body, takes head + back props |

The four humans are deliberately separated on **build + hair silhouette + palette** so any two on screen together read as different people at 96px. The two animals split small-critter vs large-beast. **No two humans share a hair colour** — Bruno red-brown, Milo ginger, Ada deep purple, Rosa blond — because hair is the single strongest identity cue at this size, and it is the one that survives a costume. Rosa's hair went blond for exactly this reason; her face colour moved off the same gold to keep hair and skin from reading as one mass (every actor's hair differs from their face, outline lines alone are too thin to carry it).

### Miss Moon — the MC (a seventh character, never an actor)

| id | name | category | shown as |
|---|---|---|---|
| `miss_moon` | Miss Moon | MC / host | an anthropomorphised moon with a big expressive cartoon face |

Miss Moon is the permanent host of the whole experience — the one character the child sees in *every* story, the through-line that makes this "our storytelling thing" rather than a gadget that plays clips. She is an anthropomorphised object with an exaggerated, hyper-expressive face and a strong, consistent voice: warm, bubbly, delighted to see the kids, and always happy to tell a story.

She is **not one of the six actors.** She never plays a role, never wears a costume or prop, and never competes for casting — so the troupe is always fully available to act. She frames the story: she opens it, bridges between scenes, and closes it. Her framing beats are **short and varied** on purpose; she appears every single time, so talky or repetitive framing would grate.

**She is the most expressive character in the system, by design.** Where the six actors share the base six expressions, Miss Moon gets an extended set — she carries the show's warmth. Authored once, reused in every story, so the extra art amortises across the whole product:

```
neutral | happy | delighted | giggling | curious | surprised | sad | sleepy | yawning
```

**Moon-phase as a mood channel (unique to her).** Her lunar phase can track her energy — bright and full when she's thrilled, a thin crescent when she's dozing. This is an expressive axis no troupe actor can have; design it in from the start.

**The sleepy / bedtime mechanic.** Miss Moon gets sleepy *only late at night*, as a gentle "time for bed" cue — a feature aimed squarely at the parent (secondary) audience: a host who yawns and says "just one more, then the moon has to sleep too" is a bedtime signal that feels like magic, not nagging.

- **Dependency:** requires local time. The device has no guaranteed clock but can pull time over WiFi via Courier. Bedtime is **parent-configurable**, and if the device can't get the time it defaults to *never sleepy*.
- **When it's decided — the one real fork.** *Generation-time* (cloud stamps the story as a "late one"): simplest, but a story made at noon and replayed at 9pm won't know. *Playback-time* (device checks the clock and shifts her live): more magical, but it's the single place the otherwise-dumb device runs real logic. Recommendation: **static/generation-time for v1, device-reactive for v2.**

**Data-model note.** Miss Moon is a cast member with the reserved id `miss_moon`, her own dedicated voice, her extended expression set, and no costume/prop layers. She is a *constant* in every performance's cast, whereas the six actors are cast per-story. Her assets bake to flash like the troupe's.

### Casting affinities (soft defaults only)

These are *tiebreak defaults*, not typecasting. Any human actor can play any human role via costume; the director overrides affinity whenever scene contrast demands it, and roles are **not** gender-locked (Ada can be a knight).

- **Bruno** → kings, giants, blacksmiths, fathers, heavy villains — big/authoritative roles.
- **Milo** → knights, heroes, princes, wizards — tall/noble roles.
- **Ada** → queens, witches, mentors, mothers, heroes.
- **Rosa** → children, fairies, sidekicks, princesses.
- **Pip** → dog, cat, fox, rabbit, small companion.
- **Tuk** → horse, cow, deer, unicorn, dragon, monster (via props).

---

## Expression set

A single enum, shared by all six actors (animals included), rendered as an eyes + mouth (+ brow) overlay:

```
neutral | happy | sad | surprised | angry | scared
```

Six is the ceiling for what reads cleanly at this resolution — subtler states (smug, confused) blur into these at 96px, so they're excluded on purpose. Each expression has a **closed-mouth** and **open-mouth** variant so the device can mouth-flap during speech (`animation: "speak"`). That's 6 × 2 = 12 tiny face overlays per actor.

---

## Layer stack

Composited on-device, back to front. Every layer shares the same frame cell and anchors (below) so any overlay drops onto any actor without offset math.

| order | layer | contents | phase |
|---|---|---|---|
| 0 | `back_prop` | wings, tail, cape-behind, shield-on-back | v2 — machinery live |
| 1 | `base` | the actor's body + head (blank face region) | **v1** |
| 2 | `costume` | armor, robe, gown, cloak — defines the role | v2 |
| 3 | `expression` | eyes + mouth overlay on the face region | **v1** |
| 4 | `headwear` | crown, hat, helmet, horn, antlers, ear-swap | v2 — machinery live |
| 5 | `front_prop` | sword, wand, staff, scepter, held item | v2 — machinery live |

**Phase 1 uses only `base` + `expression`.** The troupe acts with faces alone — recognisable actors changing emotion. Costumes and props are the v2 upgrade. Nothing about v1 blocks v2; the extra layers are simply absent until then.

> **Headwear is the v2 concept test and its machinery is live end to end**: layer catalog in `troupe.json`, `cast.layers` and `beat.layers` in the schema, validator rules (`UNKNOWN_LAYER`, `LAYER_MISFIT`), shared art under `sprites/layers/headwear/`, and the on-device compositor slot. The reference fixture's dragon wears `horns`; a `crown` proves the author-once-fits-every-human anchor rule.

> **The catalog is `troupe.json`, and it is the only list.** What exists, which slot it occupies, who it fits, and what it signals live in that file's `layers` array — one entry per item, each carrying a `description` an author can act on (the schema requires it; `tests/troupe-catalog.test.ts` enforces that it says something). This document explains how the slots behave and cites items as examples; it is deliberately **not** a roster, and neither is `story-create`'s skill. A prose copy of the wardrobe goes stale the first time a layer lands — and the author reads the copy, not the catalog. So a new layer is castable the moment its entry lands, with nothing here to keep in step.

> **Author-once stops at the hairline.** The anchor rule makes one grid land correctly on every human head, but landing correctly is not the same as *reading* correctly. A `crown` is an object sitting on hair, so one gold grid serves all four; a `fringe` **is** hair, so it carries a hair colour and can only ever match the one head wearing that colour. It is drawn in Ada's deep purple and `fits: ["ada"]` alone — on the other three it read as a wig. Any future layer that replaces hair rather than covering it inherits this: scope it to its wearer, or author it per actor. Until the draw path can recolour a layer per wearer, the catalog carries the restriction instead.

> **`back_prop` is live too, and it is the slot that proved the model generalises.** It anchors differently on purpose: headwear registers on the *face box*, a back prop on the actor's whole *ink box* — wings sit behind shoulders, not behind a face — and it draws **before** the base, so the body occludes it and only what clears the silhouette shows. `wings` is its first item, and `just-you-wait`'s caterpillar wears it to become a butterfly. Two consequences worth knowing: a back prop is forgiving of imprecise art, because its lower half is hidden anyway; and a back prop may be authored WIDER than the screen when its sidecar declares a `bleed_x` budget, which is how `wings` spans 26 authoring pixels against a 22.5-pixel screen — the tips run off the edges on purpose, and anything past the declared budget is still a build error. The budget is horizontal only — there is no vertical equivalent, because above the actor is headroom the bound already allows, and below the baseline is under the floor. `costume` remains schema-only until its own art and draw order land.

> **`front_prop` is live, and it anchors on a hand.** The third anchor rule: headwear registers on the *face box*, a back prop on the *ink box*, a held item on a per-actor **hand anchor** (`meta.json`'s `hand` — the fist pixel of the base art; the four humans have one at the fist and `tuk` has one at the muzzle for `fire`, so the slot is held-item-human-only by catalog `fits` rather than by construction). It draws **last**, in front of everything, because that is what "held" means. Two authored-in rules: a front prop *overlaps, it does not flank* — at 6× there is almost no screen beside a body (bruno has 3px total), so the sword rises across the chest, which drawing topmost makes legible; and because it overlaps wearers of every palette, its read must come from its own full `k` enclosure, never from what is behind it. Hand anchors travel with the app (`S.hand`), not the firmware — placement metadata stays out of the art fingerprint, so a grip tweak is a story push, not a fleet reflash. `sword` is the slot's first item; the knight carries it, and the dragons wear horns alone — wings came off them when `wings` became a butterfly, because two creature signals on one silhouette fought each other.

> **A layer is a costume or a reveal.** `cast.layers` is what a role wears throughout — the king's crown. `beat.layers` overrides that set slot by slot for one beat, which is how a story *stages* a prop: in Meet the Improv Troupe, Tuk introduces himself bare-headed and the next beat puts the horns on for "a DRAGON!". A slot the beat doesn't mention keeps the costume; an explicit `null` strips it. The build resolves the merge, so the device only ever draws a set it was handed.

> **Casting rule — one actor, one role.** *(Reinstated 2026-09-18, after lifting on 2026-09-01.)* A base actor holds at most one role in a story. A story that wants an actor twice must cut, merge, or narrate away one of those roles — after trying to restructure the staging first. This is the binding casting constraint, and it is a headcount: six story roles plus Miss Moon.
>
> *Why it moved twice.* With no costume or headwear, two roles played by the same base actor were the *identical picture* (Tuk-as-horse and Tuk-as-dragon, pixel-for-pixel the same), so doubling was invisible and confused the child — which is what the original Phase 1 rule was for. Layers changed the picture, and on 2026-09-01 the rule lifted to *doubling must be legible*: allowed when the two roles differ in at least one layer slot, horns on the dragon and bare on the horse. That lift was retracted on 2026-09-18, with layers shipped and the condition met, so it is a change of mind rather than a correction. The reason worth keeping is the half layers never solved: an actor's signature voice is the same in both roles, so a dressed-apart double still *sounds* like one character, and per-role voice modulation does not exist. The validator enforces it as `ACTOR_DOUBLED`.

---

## Frame layout & anchors

- **Cell:** 96 × 96 px, transparent background. Character ~80 px tall, feet on the baseline, centered.
- **Shared anchors (humans):**
  - `head_center` = (48, 28) — face overlays and headwear register here
  - `feet_baseline` = y 86
  - `hand_left` = (32, 54), `hand_right` = (64, 54) — held props register here
- **Animal anchors** are a separate set (lower/forward head, no standard hands; props attach to head and back only). The one exception is a *mouth* anchor: `tuk` carries a `hand` entry at his muzzle, because `fire` leaves a dragon's mouth and needs the last-drawn slot a held item gets, and the only other head-anchored slot is headwear — which the dragon is already wearing horns in. It opens the slot, it does not put anything in his fist: every held item's `fits` stays human-only and the validator enforces it, so the anchor grants a mouth prop and never a sword. `pip` shares the humans' 12×8 face-box dimensions; `tuk` diverges at a larger 16×10 face box carrying double-resolution expression overlays (see the 2026-07-21 hi-res-faces addendum).
- **Expression fidelity via double resolution.** Overlay grids can be authored at 2× the face box and drawn at half the actor's scale for finer eye/mouth detail — the whole troupe ships hi-res faces (whites/pupils/brows for the 6× actors; `miss_moon`'s 4× disc carries her bespoke set — sparkle pupils, wink, blush — at 2×). Layer art (costumes and props) gets the same treatment: an item's sidecar declares `density: 2` to be authored at double resolution and drawn at half the actor's scale (e.g. `wings` and `witch_hat`), the same way faces do — declared per item, not detected from the grid, and defaulting to 1 when the sidecar omits it.
- **Palette:** one shared limited palette (~16 colors, Game-Boy-lo-fi register) so every layer composites coherently and every asset stays tiny. Costumes are authored in a neutral ramp and **palette-swappable at draw time**, so the director can recolor a tunic to force contrast between two same-costume characters.
- **Frame count, v1:** per actor = 1 body pose + 12 expression overlays. Static pose; the actors are stationary and "act" through face + optional idle bob. No walk cycles.

The one rule that makes all of this work: **every layer for a given actor-type uses identical anchors.** Author a sword once, it fits every human. Author a crown once, it fits every human head.

---

## Costume + prop vocabulary (v2 starter)

Roles are assembled, not drawn. A starter mapping:

| role | base | costume | headwear | front_prop | back_prop |
|---|---|---|---|---|---|
| knight | any human | armor | helmet | sword | shield |
| king | Bruno/any | robe | crown | scepter | — |
| queen | Ada/any | gown | crown | — | — |
| princess | Rosa/any | gown | tiara | — | — |
| wizard | Milo/any | robe | pointed hat | staff | — |
| witch | Ada/any | dark robe | witch hat | — | — |
| villain | any human | dark cloak | — | — | — |
| fairy | Rosa/any | — | — | wand | wings |
| dog/cat/fox | Pip | — | ear-swap | — | tail |
| horse | Tuk | — | mane | — | — |
| unicorn | Tuk | — | horn | — | — |
| deer | Tuk | — | antlers | — | — |
| dragon | Tuk | — | horns | — | — |

The **dragon is Tuk (a horse-shaped beast) wearing horns.** It will look endearingly wrong. That is the intended charm, not a defect to fix. Wings are deliberately not part of it: `wings` is a butterfly pair authored for upright bipeds, and on a side-on quadruped it lands beside the head rather than on the back.

---

## The sfx repertoire

The sounds are a shared repertoire, not per-story assets: `gen-sfx` synths are deterministic, so `sfx_roar` is byte-identical in every story that ships it, and the title chime opens every performance. That repetition is a feature — children recognize the same roar across stories the way they recognize the actors. `troupe.json`'s `sfx_catalog` is the per-sound truth (what it sounds like, when to use it, when not to); these are the rules that span sounds:

- **Same sound, same meaning, every story.** Reuse the repertoire rather than wishing for new sounds; a sound that means something different per story spends the recognition the repertoire exists to build.
- **Creature-voice sounds belong to characters.** `roar`, `neigh`, `bark` and `squeak` read as *someone's voice*. Within a story, keep each attached to one character — two characters sharing a voice-sound is as confusing as two roles on one Phase 1 actor.
- **Punctuate, don't underscore.** A cue marks a moment — a reveal, an action, a punchline. One cue per beat is the norm; the tiny speaker turns layers into mud.
- **Offsets are estimates until TTS renders.** Cues timed against authored beat lengths get re-anchored after `--write-durations`; the validator's `SFX_PAST_END` is the net.
- **When nothing fits**, pick the nearest sound in meaning, or flag a vocabulary addition as an engineering follow-up (synth + buzzer gesture + test pins — `sfx_squeak` is the worked example). The vocabulary is exactly the implementable set; a story never cues a sound that doesn't exist.

Worked examples: the knight's `whoosh` is the princess carried off and `shing` the sword drawn; the lighthouse's `bark` is Pip raising the alarm; Meet the Improv Troupe opens on Miss Moon's `sparkle` flourish and lands `fire` on Tuk's "DRAGON!".

---

## Casting rules for the director

1. **Contrast first.** Assign actors so co-present characters differ in silhouette *and* palette; recolor costumes if two would otherwise clash. Distinguishability beats accuracy.
2. **The costume is the role, not the actor.** Cast for contrast and availability, never by matching a character's described appearance to an actor's look.
3. **One bold prop, not detail.** Signal a role with a single strong feature (crown, sword, horn). Headwear and back_prop art can carry fine detail now that it draws at double resolution — this is a staging limit, not a pixel-budget one: a beat still has to read in one glance, and stacking several detailed props on one character muddies that glance regardless of how sharp each one is on its own.
4. **Funny-wrong is allowed.** Never refuse a role because the base actor is an imperfect fit. A horse-dragon is good.
5. **Never double.** One actor, one role — in every phase, dressed apart or not (see the casting rule above). If a story needs more characters of a type than the troupe has actors, restructure the staging first (rule 6); if it still will not fit, cut or merge the extra role.
6. **Prefer restructuring over demanding a missing actor.** Before declaring a story uncastable, rewrite the staging: change who travels how, stagger entrances, let one character's ability replace another's role (the dragon flies everyone home instead of a horse). Restructuring a scene is nearly always cheaper than the troupe lacking an actor, and it's the director's main tool for keeping stories in range.
7. **Palettes are for contrast only.** Do not cast based on a character's stated skin colour or ethnicity. Actor palettes exist solely to keep the cast visually separable.

---

## Honest limits (the ceiling)

The limits differ by phase and by how many devices are on stage. An earlier draft of this file claimed a flat "no two large beasts on screen at once" ceiling — that was wrong for a single device, and the correction matters:

**Single device (v1 and v2).** Only one sprite shows per beat; characters alternate in time, never sharing the screen. So two large beasts (dragon *and* horse) are never a simultaneity problem here — the same base actor simply plays both in different beats. The only catch is legibility:
- **In every phase**, a story needing both must restructure, drop, or merge one — see the casting rule above. Doubling is refused whatever the layers can do, so this is not a Phase 1 limitation that v2 lifts.
- *For the record:* v2's layers **can** make a doubled actor legible to the eye, and between 2026-09-01 and 2026-09-18 that was the rule. It was reinstated because legibility to the eye was never the whole problem — the voice is actor-bound and a dressed-apart double still sounds like one character.

**Multi-device (v4).** Now each character has its own physical device and they're co-present on the table. *This* is where simultaneity bites: two distinct large beasts at once would need two `tuk` devices, and doubling breaks because a physical actor can't be in two places. Plan the v4 device roster and story catalog around that; it's a hardware constraint, not a casting one.

**Independent of device count**, the troupe genuinely cannot do:
- **Ensemble stories** with many simultaneous distinct creatures → out of scope.
- **Premise-specific unmappable characters** (a story that only works if the hero is a sentient teapot) → deferred to the future generative long-tail phase; the troupe won't fake these convincingly and shouldn't try.

When a story is genuinely unmappable, the director should first try restructuring (rule 6). If it still won't fit, say so and ask the author to adjust, rather than casting something incoherent.
