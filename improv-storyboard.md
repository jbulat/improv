# Storyboard — "The Knight and the Lonely Dragon"

One story, cast against the troupe twice: **Draft A** (Phase 1 — `base` + `expression` only) and **Draft B** (End goal — full layer stack). The point is to expose where the six-actor troupe strains, so read the annotations, not just the beats.

> **Re-drafted 2026-09-18.** Draft B previously cast `tuk` as both the horse and the dragon, on the *doubling must be legible* rule (lifted 2026-09-01). That lift has been **retracted**: an actor holds at most one role in a story, in every phase, dressed apart or not. See `improv-troupe.md`'s casting rule for the rule and its history.
>
> **Draft B is re-cast below** — the horse becomes a pony played by `pip`, and the story still survives intact. **Draft A is unchanged**: it never doubled, and its beat structure is what `fixtures/knight-and-lonely-dragon` actually ships, so it is a record rather than a draft. What the re-draft *did* expose about Draft A is annotated in place rather than edited into it.

**Synopsis.** A dragon carries Princess Rosa to a dark mountain. Sir Milo rides out to save her, but discovers the dragon isn't cruel — just lonely. Instead of fighting, he offers friendship, and the dragon flies everyone home. Wholesome, non-violent resolution, ~15 beats.

**Roles → actors.** Host = `miss_moon` (Miss Moon, the MC) · Knight = `milo` · Princess = `rosa` · Dragon = `tuk` · Pony = `pip` (Draft B only). Four story roles against a troupe of six — **this story never needed doubling**, which is the thing the first draft got wrong.

> **Host:** the framing beats are Miss Moon, the permanent MC — not one of the six actors and never cast in a role. She opens, bridges, and closes. See `improv-troupe.md`.

---

## Draft A — Phase 1 (base + expression only)

No costumes, no headgear, no props. Every character is a bare actor body plus a face. That single constraint rewrites the story, and the table shows how.

| # | role → actor | base sprite | expression | line | sfx |
|---|---|---|---|---|---|
| 0 | Host → miss_moon | miss_moon | delighted | "In a green kingdom lived a brave knight named Sir Milo." | — |
| 1 | Host → miss_moon | miss_moon | surprised | "One day a dragon carried Princess Rosa off to a dark mountain!" | whoosh |
| 2 | Knight → milo | milo | angry | "I will bring the princess home!" | — |
| 3 | Host → miss_moon | miss_moon | curious | "He traveled three days, over hills and rivers, to the mountain." | — |
| 4 | Host → miss_moon | miss_moon | curious | "At the mouth of a cave, something was waiting…" | — |
| 5 | Dragon → tuk | tuk | angry | "Who dares enter MY mountain?" | roar |
| 6 | Princess → rosa | rosa | scared | "Sir Milo! Help me, please!" | — |
| 7 | Knight → milo | milo | surprised | "Stand back, dragon!" | shing |
| 8 | Dragon → tuk | tuk | angry | (breathes fire) | fire |
| 9 | Knight → milo | milo | scared | "Wait — why are you so angry?" | — |
| 10 | Dragon → tuk | tuk | sad | "No one ever visits. I am always alone." | — |
| 11 | Knight → milo | milo | happy | "Then let's be friends. Come to our kingdom!" | — |
| 12 | Princess → rosa | rosa | happy | "You're not so scary after all." | — |
| 13 | Dragon → tuk | tuk | happy | (a warm, rumbly laugh) | chime |
| 14 | Host → miss_moon | miss_moon | happy | "So the dragon flew them home, and was never lonely again." | chime |

**What Phase 1 forced (read this):**

- **The horse is gone**, and beats 3–4 became Miss Moon host narration. The reasoning at the time: the knight rides his horse (`tuk`) to the mountain and then meets the dragon (`tuk`), and with base-only rendering *the horse and the dragon are the identical sprite* — same body, only the expression differs. A child would see the same animal called "horse" then "dragon" and be confused.
- **That reasoning had an unexamined premise, found on 2026-09-18: it assumed a horse has to be the large beast.** It does not. `pip` is a separate base sprite, and a knight on a small scruffy pony is *funny-wrong*, which casting rule 4 explicitly allows. Cast that way the horse survives Phase 1 too, with no layers needed — because the legibility problem was never about layers, it was about two roles sharing one body.
- **Draft A is left as it stands anyway**, because it is the record of what `fixtures/knight-and-lonely-dragon` ships: the same fifteen beats in the same order, with the knight's helmet and sword, the princess's tiara and the dragon's horns added once those layers existed. Changing it would make this document disagree with the bundle. The lesson is the annotation, not a rewrite.
- **The cost of that premise was a character.** Worth naming plainly: the troupe had a free actor the whole time, and the draft cut a role rather than cast it.
- The two humans (`milo`, `rosa`) are fine — different bodies, clearly distinct on expression alone.

---

## Draft B — End goal (full layer stack)

Costume, headwear and props make every role read instantly, and the pony rejoins the story. Layers listed as `costume / headwear / prop / back_prop`. Items not yet in `troupe/troupe.json` are marked `*` — this draft is the end goal, not the current catalog.

| # | role → actor | base | expression | layers (costume / headwear / prop / back) | line | sfx |
|---|---|---|---|---|---|---|
| 0 | Host → miss_moon | miss_moon | delighted | — (full phase) | "In a green kingdom lived a brave knight named Sir Milo." | — |
| 1 | Host → miss_moon | miss_moon | surprised | — | "One day a dragon carried Princess Rosa off to a dark mountain!" | whoosh |
| 2 | Knight → milo | milo | angry | armor\* / helmet / sword / — | "I will bring the princess home!" | shing |
| 3 | Pony → pip | pip | happy | — / mane\* / — / — | "He leapt onto his trusty pony and galloped away." | gallop |
| 4 | Pony → pip | pip | scared | — / mane\* / — / — | "The pony climbed until it could go no higher, and stopped." | neigh |
| 5 | Dragon → tuk | tuk | angry | — / horns / — / — | "Who dares enter MY mountain?" | roar |
| 6 | Princess → rosa | rosa | scared | gown\* / tiara / — / — | "Sir Milo! Help me, please!" | — |
| 7 | Knight → milo | milo | surprised | armor\* / helmet / sword / — | "Stand back, dragon!" | shing |
| 8 | Dragon → tuk | tuk | angry | — / horns / fire / — | (breathes fire) | fire |
| 9 | Knight → milo | milo | scared | armor\* / helmet / sword / — | "Wait — why are you so angry?" | — |
| 10 | Dragon → tuk | tuk | sad | — / horns / — / — | "No one ever visits. I am always alone." | — |
| 11 | Knight → milo | milo | happy | armor\* / helmet / — / — | "Then let's be friends. Come to our kingdom!" | — |
| 12 | Princess → rosa | rosa | happy | gown\* / tiara / — / — | "You're not so scary after all." | — |
| 13 | Dragon → tuk | tuk | happy | — / horns / — / — | (a warm, rumbly laugh) | chime |
| 14 | Host → miss_moon | miss_moon | happy | — (full phase) | "So the dragon flew them home, and was never lonely again." | chime |

**What the layers buy:**

- **Roles read instantly.** Milo in armor with a sword is a knight before he speaks; Rosa in a gown and tiara is a princess. In Draft A they were just Milo and Rosa, and the *lines* had to carry the casting.
- **The story survives intact** — nothing cut, nothing doubled. Four distinct actors play four distinct roles, which is what the troupe was always big enough for.
- **The dragon breathes.** Beat 8 puts `fire` in the front_prop slot rather than leaving the moment to the sfx alone. That layer ships today and fits `tuk` only, which is the one thing his muzzle anchor exists for.
- **What the layers do *not* buy, corrected 2026-09-18.** The earlier version of this draft claimed layers "unlock doubling" and called that "the entire reason to build v2". **Doubling is refused in every phase**, so that is not what v2 is for. Layers earn their place on legibility and charm — a knight who looks like a knight — not by stretching the headcount.

> **Bedtime variant (v2, device-reactive).** If this story is played late at night, beat 14 flips: Miss Moon goes `sleepy`, her phase thins to a crescent, and her sign-off becomes something like *"…and they all slept soundly. The moon has to sleep too, now — one more tomorrow?"* Same timeline, a runtime swap driven by local time. This is the parent-facing bedtime cue doing its job.

**Two things this re-draft asks of the art backlog**, named rather than assumed:

1. **`mane` should fit `pip`, not only `tuk`.** `improv-troupe.md`'s v2 starter vocabulary maps `horse → Tuk / mane`, scoping the layer to the large beast. Under one-actor-one-role, a story that has a dragon in it cannot also have a Tuk horse — so `mane` is more useful as an `animal` layer than a Tuk one, and Pip's pointed ears above a mane are exactly the funny-wrong the troupe is for. Not changed in the troupe file here; flagged for whoever authors the layer.
2. **`armor` and `gown` remain unauthored.** The `costume` slot is declared in both schemas and is still empty. Those two are the oldest entries on the layer backlog, and this draft is the reason they matter.

---

## The seams this exposed

1. **A base actor holds exactly one role per story**, in every phase. Design the story catalog around that, or the director will silently drop characters — which is exactly what happened here: Draft A cut the horse while `pip` sat unused.
2. **Check who is free before declaring a story over-cast.** The original analysis reasoned from the role — "a horse is a large beast, so a horse is Tuk" — and concluded the troupe was one actor short. Reasoning from the *roster* instead, four roles against six actors, the story always fit. Casting rule 2 says the same thing from the other end: cast for contrast and availability, never by matching a character's described appearance to an actor's look.
3. **The "two large beasts" ceiling did not bite here** — on one device only one sprite shows per beat, so the pony and the dragon are never on screen together anyway; they alternate in time. That ceiling is a **v4 multi-device** problem (two physical Tuk devices can't both be on stage), not a single-device one.
4. **Restructuring beats the ceiling cheaply.** The dragon flies everyone home instead of the pony — the director can rewrite transport, staging and entrances to keep a story inside the troupe. That is casting rule 6, and re-casting a role is its cheapest form.
5. **The host is Miss Moon** (resolved). She carries 5 of 15 beats here — the opening, two bridges, and the sign-off — which is exactly why she needed to be a real character with personality and her own extended expression set, not a flat narrator. Her bedtime behaviour (above) is a genuine feature, not decoration.
6. **A worked example outlives the rule it was drafted under, and keeps teaching it.** This document argued for eighteen days that unlocking doubling was "the entire reason to build v2" — a claim that survived the rule being reinstated, because nobody re-reads a storyboard when a casting rule changes. When a rule moves, the examples built on it move too, or they become the most persuasive stale documentation in the repo.
