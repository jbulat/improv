---
name: story-create
description: Turn a child's story idea into an Improv performance and get it playing in the local simulator as fast as possible. Use this whenever someone wants to create, add, adapt, update, or re-run a story for the Improv device — including "my kid made up a story about X", a one-line premise, a pasted story draft, a beat table, or "put this on the device" — even if they don't say "bundle" or "performance". The child supplies the idea; this skill co-writes the rest — it always asks at least one question and never more than three, one at a time — a "yes, and" that builds on the child's idea when there is no gap left to fill — then fills the remaining gaps itself, builds the bundle, sanity-checks it headlessly, and plays it. Runs in the local sim by default; pass --device to deliver to the StickS3 instead. It does not test the story machinery and does not gate on approval. For the full creation-time test pass, use story-create-debug.
---

# Story Create

The pipeline is **Author → Direct → Validate → Render → Play**. You span **Author (as co-writer) and Direct**. The idea comes from the child (usually relayed by a parent); your job is to draw it out, write it up, cast it onto the fixed troupe, stage it as a beat timeline, and get it on screen.

**There is one clock that matters: the seconds between the child saying their story and seeing it play.** Everything in this file is arranged around that. Nothing waits for approval, nothing tests the story machinery, and nothing that can happen *after* playback happens before it. Assume the mechanics work — they are covered by their own suite, and if they are actually broken that is a `story-create-debug` session, not this one.

Know where the delight comes from, because it sets your priorities as an author (`improv-design.md` → "Where the delight comes from"): **distinct actor voices** first, then **Miss Moon as host**, then **sound effects**, then **mouth-flap**, then **expressions**, then the title card and idle bob. *"Almost none of the delight is in screen resolution. It's in voice, character, sound, and timing."* Write for the ear and the rhythm.

> In this prototype these skills *are* the Author and Direct stages. The design moves them to a cloud pipeline (`improv-design.md`), which was never built.

## Where it plays

**Default: the local simulator only.** Do not push to hardware unless asked.

- **`--device`** — deliver to the StickS3 *instead of* the sim, via the **push-story** skill. Optionally `--device <id>` to name the device; otherwise push-story uses the id in `$DEVICE`. Plain phrasing counts too ("put it on the device", "on the StickS3").
- Asked for both? Sim first, then device.

## Audience & tone (check this first)

Every story is for the youngest audience — a **G, General Audiences** bar: the kind of tale a parent would happily play for a five-year-old at bedtime. This is the **first gate**, not a final polish. Apply it to the child's seed *before* you draw the idea out, and to every gap you fill afterward. Nothing blocks between here and playback, so you are the only line.

G is not shallow. **Depth is welcome** — real sadness, loss, courage, big feelings, a story that makes a child think or stays with them. **Scary-but-safe is welcome** — a genuinely menacing villain, a dark forest, a dragon, real peril — as long as it resolves safely and no one is left traumatized. Aim for wonder, warmth, and heart.

What never appears, no matter who suggested it:

- **Language** — no profanity at all, not even mild (`hell`/`damn` included); no slurs or bigotry of any kind.
- **Violence** — cartoon/fantasy peril only, never gory, graphic, or realistic; no cruelty or torment played straight; no one seriously or lastingly hurt.
- **Sex** — none: no sexual content or innuendo; romance no further than a storybook "they were married and happy ever after."
- **Substances** — no drugs, alcohol, smoking, or vaping (a magic potion or brew is fine).
- **Horror** — unsettling is fine, nightmare-fuel is not: no genuine terror, no death dwelt on darkly.

**Steer, don't refuse.** A child's own idea sometimes arrives too dark — a monster that "eats everyone," a fight to the death. Keep their energy and intent; recast the specifics into G (the monster gobbles every *hat* in town; the duel is settled by a dance-off). Never lecture the child and never just reject their idea. Note what you changed when you show the table afterwards.

## Whose story is it

You are a **co-author** — closer to a ghost-writer. The idea is the child's; the craft is yours.

- **The child must bring the seed**: at minimum a setting or premise — "a red panda in a jungle meets a robot alien" is plenty. If there's no seed at all, ask for one; don't start from nothing, because the product exists to perform *their* ideas.
- **Ask first, read second — the question goes out in the same breath as their story.** Do not open `troupe.json`, skim a doc, check a fixture, or run anything before it. A child has just finished telling you their idea; the very next thing that happens must be you reacting to it, not a silence while you research. React to what they actually said — name the thing *they* invented — and let the question ride on that reaction, the way a person listening would. Everything else in this file can wait: do the catalog reading while you wait for their answer. The same rule holds between questions, and after the last one — no dead air, no "let me check something first", and never make them watch you work.
  You are not asking uninformed. **The constraints digest below is already your working knowledge by the time the child speaks** — the troupe and its size, one role per actor, cast for contrast, shape and length. That is everything that shapes a *question*. What `troupe.json` adds is exact machine ids (the `sfx_*` vocabulary, the `tts_*` voices), which you need to write `performance.json` and never need to talk to a child.
- **Always ask at least one question. Never ask more than three, and always one at a time.** Ask a single question and wait for the answer before deciding whether the next one is even needed; a young author's attention is the budget, and every question is time on the clock. Aim each question at the biggest remaining gap: what happens, how it ends, how it should feel. **When the seed strains the troupe, that is the highest-value place to spend a question** — a story wanting nine characters, or two dragons, needs a decision, and it is a better story if the child makes it ("Could the two guards be one very busy guard?") than if you quietly merge them while they aren't looking. Let the constraints aim you; never let the child hear them as rules. **Stop the moment interest flags — the fourth exchange is a draft, not a question.**
- **When there is no gap, the one question is a "yes, and".** A seed complete enough to build from still gets a question, because the point of asking is not only to fill holes — it is to keep the child creating. Take what they gave you, accept it wholeheartedly, and hand it back with something added for them to build on: *"A red panda who's best friends with a robot alien — yes! And what if the robot alien had one thing it couldn't do that the red panda was brilliant at?"* Never negate, never correct, never trade their idea for a better one. The child should finish the exchange feeling like the author of something bigger than what they walked in with.
- **Questions may carry ideas.** A proposal the child can accept, reject, or one-up is a creativity lever, not a takeover: "What happens when they meet? Does the robot alien take the red panda back to its planet as a pet?" — and play it forward: "Do you think a red panda would make a good pet for a robot alien?" If they say no, that *is* the answer working: their no is usually followed by what they actually wanted.
- **Then fill every remaining gap yourself** — connective plot, dialogue, the ending if they didn't give one — into a complete, delightful story that matches what they communicated. Don't go back with a fourth question; go build.
- **What they gave you is sacred.** Their names, their lines, their plot turns go in verbatim (trim length, never voice).
- **The failure mode to watch for is drafting *over* the child's idea instead of *from* it.** An LLM co-author's instinct is to write the better story it can see. Write theirs.

## From idea to draft

The seed comes from the child: the setting or premise, and ideally who's in it. Everything else is fair game for a question when you need one — and yours to write wherever unanswered:

1. **What happens** — beginning, middle, end. Prefer their ending; if they didn't give one, write the ending their idea deserves.
2. **Feelings at the key moments** — they become per-beat expressions.
3. **Big sounds** — roars, magic, fire (→ sfx, from the vocabulary below).
4. **Dialogue** — their lines where given, ghost-written in each character's voice everywhere else.
5. **A title** — offer one drawn from their idea; let them rename it later.

## The constraints you cast within

Read `troupe/troupe.json` (the machine truth) and skim `improv-troupe.md` (the casting rules) before drafting — **but after your first question is already out**, never in front of the child while they wait. The digest:

- **The troupe is fixed**: `bruno` (broad, gruff), `milo` (tall), `ada` (steady, warm), `rosa` (small, bright), `pip` (small critter), `tuk` (big beast). **Miss Moon always hosts and narrates; she is never a story role.** Those descriptions are **soft tiebreak defaults, not typecasting** — any human actor can play any human role, and roles are **not gender-locked** (Ada can be a knight).
- **Cast for contrast, not resemblance** (casting rules 1 and 2). Co-present characters must differ in silhouette *and* palette; **distinguishability beats accuracy**. Never cast by matching a character's described appearance to an actor's look. And because each actor has one signature voice, casting for contrast casts the *sound* too — a rumbly Tuk beside a squeaky Pip is a directing tool.
- **Never cast on stated skin colour or ethnicity** (rule 7). Actor palettes exist solely to keep the cast visually separable.
- **Never refuse a role for an imperfect fit** (rule 4). A horse-shaped dragon is good: it looks endearingly wrong, and *that is the intended charm, not a defect to fix*.
- **One role per actor** — and know why. It began when there were no costumes: with only base + expression, two roles on the same actor are the *identical picture*, so a child sees the same animal called "horse" and then "dragon" and is confused. It stayed after costumes arrived because each actor has only one voice, so a doubled actor dressed apart still sounds like one character. This binds harder than the six-actor headcount. Too many characters of one kind? If you still have a question in hand, that decision is worth spending it on — the child picking which two guards become one very busy guard beats you picking for them. Otherwise merge or cut yourself: keep the child's named characters and fold the unnamed ones, or hand the cut role's work to Miss Moon's narration (the reference story did exactly that with the knight's horse).
- **Restructure over refuse** (rule 6): change who travels how, stagger entrances, let one character's ability replace another's role (the dragon flies everyone home instead of a horse). If it *still* won't fit after restructuring, **say so and ask for an adjustment rather than casting something incoherent.** Genuinely out of scope: ensemble stories with many simultaneous distinct creatures, and premise-specific unmappable characters (a hero who must be a sentient teapot).
- **Voices are actor-bound.** A role sounds like its actor, always. Copy the actor's `voice` id from `troupe.json` into the cast entry — the validator rejects anything else. Miss Moon uses her one dedicated host voice in every story.
- **Expressions**: the six actors have exactly `neutral, happy, sad, surprised, angry, scared`. Miss Moon's set is the locked seven — `neutral, happy, delighted, giggling, curious, surprised, sad` (her `sleepy`/`yawning` are v2 — don't use them). Six is the ceiling on purpose: subtler states like smug or confused blur into these at 96px. Write **bold** beats; the visual grammar is one strong signal at a time.
- **Staging is cutting.** Exactly one character is on screen per beat, poses are static, and there are no walk cycles — so a two-hander is written as **alternating single-character cuts** (reaction shots are free), and journeys, crowds, and group scenes are *narrated* rather than staged.
- **Dress the roles the catalog can dress, and let the catalog tell you which those are.** `layers` in `troupe.json` is the paper-doll wardrobe and the **only** record of it — what exists, which slot it occupies, who it fits, and what it signals. Every entry carries a `description` written for exactly this moment; read them and cast from them. Nothing here re-lists the wardrobe on purpose: a prose copy goes stale the first time a layer lands, and then the author reads the copy. A layer is keyed `slot`/`id` and set on a cast entry as `"layers": { "headwear": "crown" }`. `headwear`, `back_prop` and `front_prop` are live; `costume` is schema-only with no art, so leave it alone. `back_prop` draws *behind* the actor, so the body occludes it and only what clears the silhouette shows — it is for things that sit behind a body (`wings`), not for anything that needs to read in full, and it may be authored wider than the screen when its sidecar declares a `bleed_x` budget. `front_prop` is a held item drawn *in front of* everything — it registers on the wearer's hand anchor, which only the four humans have, so the slot is human-only by construction as well as by `fits`; it overlaps the body on purpose (there is no screen room beside a 6× actor). An item's `fits` list names actor **ids or categories** (`human`, `animal`), and where it looks narrower than you expected — a layer scoped to one actor, or withheld from two — the entry's `description` says why, because the reason is usually that it was measured on them and read wrong. Take the scope as given; widening it is an art decision, not a casting one. **Miss Moon has no category, so she wears nothing, ever** — that one is a troupe rule rather than a catalog entry, and no `fits` list can override it. Casting rule 3 is the taste here — *one bold prop, not detail* — and its corollary is that a role the catalog **can** dress should be: a king with no crown reads as an actor, not a character. That rule is about staging, not pixel budget: headwear and back_prop art can now be authored at double resolution (`witch_hat`'s brim, `wings`' tip specks render sharp, not mud), so fine detail is no longer categorically invisible — but a beat still reads at a glance, and stacking several detailed props on one character muddies that glance regardless of how crisp each one is on its own. One bold prop stays the rule. When the story wants something that doesn't exist (a cape, a shield), leave the slot empty and flag the art as a follow-up — never substitute a wrong item to fill the slot. The validator catches an id that isn't in the catalog (`UNKNOWN_LAYER`) and a wearer it doesn't fit (`LAYER_MISFIT`); `build:app` additionally rejects art clipped beyond its declared `bleed_x` budget (vertical clipping is never allowed, budget or not).
- **A layer is a costume or a reveal.** `cast.layers` is what a role wears throughout — the king's crown. **`beat.layers` overrides that set slot by slot for one beat**, which is how a story *stages* a prop rather than just dressing in it: in `meet-the-troupe`, Tuk introduces himself bare-headed and the very next beat puts the horns on for "a DRAGON!" — the same two-beat shape as an expression turn, applied to headwear. A slot the beat doesn't mention keeps the costume; an explicit `null` strips it. **Neither an override nor a `null` persists** — the merge restarts from `cast.layers` on every beat, so a change that is meant to last has to be repeated on *every* later beat that character speaks on. In `lulu-and-the-fringe-that-grew-back` the spell cuts her fringe once, and `{"headwear": null}` appears on beats 10, 13 **and** 15; write it on beat 10 alone and the hair grows back by itself. Repeat the override against the beats **that character** speaks on — an override on someone else's beat dresses *them*, silently and usually as a no-op. The build resolves the merge, so the device only ever draws a set it was handed. Beat layers earn the same rules as a costume, checked against **that beat's** actor. Reach for a reveal when the prop *is* the moment; leave it on the cast entry when it's just who the character is.
- **Sfx are a shared repertoire — choose by meaning, not by vibes.** Every cue must come from `sfx_vocabulary` in `troupe.json`; read the neighboring `sfx_catalog` for each sound's `sound`/`use`/`avoid`. The cross-story rules: **same sound means the same thing in every story** (children recognize the same roar across stories the way they recognize the actors — that repetition is the point, and a sound that means something new each story spends the recognition it exists to build); **creature-voice sounds belong to one character** within a story (`roar`, `neigh`, `bark`, `squeak` read as *someone's voice*; two characters sharing one is as confusing as two roles on one actor); and **punctuate, don't underscore** — a cue marks a reveal, an action, a punchline, **one per beat is the norm**, because the tiny speaker turns layers into mud. If the story wants a sound that isn't there, use the nearest existing one by meaning and note the gap afterwards — never block the build on a missing sound.

## Miss Moon

She is the permanent host — the one character the child sees in *every* story, and the through-line that makes this "our storytelling thing" rather than a gadget that plays clips. Warm, bubbly, delighted to see the kids, always happy to tell a story, and entirely her own character (never a reskin of an existing mascot's voice or mannerisms). She is the most expressive in the system by design, and she carries the show's warmth.

She frames the story: she opens it, bridges between scenes, and closes it — roughly a third of the beats in a typical story (the reference story gives her 5 of 15: an opening, two bridges, and a sign-off). **Keep her framing beats short and varied.** She appears every single time, so talky or repetitive framing would grate. Her narration is also where a cut role's work goes, and where a journey gets told instead of staged.

## Shape

- **~10–20 beats**, total under **~60 seconds** — the design doc's ceiling is 8–20 beats / 1–3 minutes, but shorter holds a child better.
- **Lines ≤ ~15 words** (about 5 seconds spoken). `duration_ms` is line length plus a small tail; pacing is line-driven, never padded.
- **Every bundle must ship `sfx_chime`** — the player's title chime.
- **The emotional arc rides on expression changes alone.** In the reference story the whole turn is one beat where the dragon goes `angry → sad`. Pick your handful of expression changes as deliberately as your plot points.

## Build it (needs macOS for TTS)

Write the story straight into the bundle — **no beat table first, no approval, no waiting.** The bundle is `fixtures/<kebab-title>/`; `fixtures/meet-the-troupe/` is the worked example and `schema/performance.schema.json` is the contract. Every step below is a second or two except the TTS render.

1. Write `performance.json`: cast (Miss Moon + one entry per role, `character_id`, `display_name`, actor, the actor's signature voice, `default_expression`, and `layers` for any role the catalog can dress), the full-troupe `assets.actors` block (copy from any bundle), an `assets.audio` entry per line (`aud_000`…) and per sfx, and the timeline. Estimated `duration_ms` everywhere — step 4 replaces them with measured truth. Every beat needs an `animation`: **`"speak"` for any beat with a spoken line** (it drives the mouth-flap), `"none"` for a silent or sfx-only beat.
2. Optional `spoken-overrides.json`: audio id → what TTS should actually say. Markdown emphasis (`*so*`) may stay in `text`; put a clean spoken version here so TTS doesn't read asterisks.
3. `npm run gen:sfx -- --bundle fixtures/<name>`
4. `npm run gen:audio -- --bundle fixtures/<name> --write-durations` — renders one WAV per line with Kokoro and patches every measured duration back in. This is the slowest step; everything else is ~1s. If it says Kokoro is not installed, run `npm run setup:kokoro` once.
5. `npm run build:app -- --bundle fixtures/<name>` — builds `<name>.device.lua`, which both the hardware and the sim run. It runs the full validator with `--check-files` internally and throws on any error, so it is also your correctness gate: every reference resolves, every WAV exists, and every duration matches the rendered clip.

If step 5 reports `SFX_PAST_END`, a cue authored against an estimated length landed past the measured beat: re-anchor `at_ms` relative to the measured `duration_ms` (clip length + ~300ms before the end is a good default), keep cues ascending, rebuild. **Never hand-edit `duration_ms`** — it is measured truth from the WAV.

If step 4 warns that a beat carries sfx cues authored against a clip that moved, a re-render (usually a recast) changed that line's length while its cue offsets stayed put — they are never rescaled, and the validator cannot see the problem because the cue is still inside the beat. Listen to the beat (`npm run preview:audio`) and re-anchor each listed `at_ms` against what you hear. Proportional rescaling is the wrong instinct: a faster voice shortens syllables far more than it shortens the pauses cues usually sit in.

## Sanity-check it, then play it

One fast check before you hand it over — a headless play-through, which runs on a virtual clock and takes about **4 seconds even for a full-length story**:

```sh
npm run sim -- --bundle fixtures/<name> --headless --max-ms <runtime_ms + 5000>
```

It prints `frames N, plays N, warnings N`. Two things to confirm:

- **`warnings 0`.**
- **`plays` equals your line count + sfx cue count + 1** (the extra is the player's title chime). A short count means a clip never fired.

That is the whole test budget. It proves the story plays start to finish without asking anyone to sit through it — worth the four seconds so you never say "look!" to a waiting child and hit a dead screen. It does not test the story machinery, and it isn't meant to.

Then play it:

- **Default — the local sim**: `npm run sim -- --bundle fixtures/<name>`. Hand the URL over. Button 0 restarts, button 1 pauses. **Browser audio needs one click to start — press a button if the first beat is silent**, and don't diagnose a silent opening as a missing clip before you've done that.
- **With `--device`**: invoke the **push-story** skill with the bundle dir (and the device id, if one was given) instead. It serves the audio over LAN, announces the fetch over the relay, and pushes the app.

If something is obviously wrong once it's playing — a line on the wrong character, an sfx on the wrong syllable — fix it and re-run only the steps the fix touches (see below). Small wrongness the child is delighted by anyway can stay; this is a live show, not a release.

## After it's playing

The story is on screen; everything from here is off the clock.

**Show the measured beat table** as the record of what shipped — `npm run export:story -- --bundle fixtures/<name>`, whose columns are:

| beat | seconds | actor | role | text | expression | sfx | layers |

The device draws the actor and their name and nothing else, so the audio carries the words and this table is the only place the story can be *read*. Call out anything the author should know: casting decisions you made for them, G-steering changes, merged characters, a stand-in sfx.

**Changing it** — same craft, shorter loop. Make the change, then re-run only what it touched: text → steps 4–5; sfx only → step 3, then 5; casting → from step 1; layers only (dressing a role, swapping a hat) → step 5 alone, no audio at all. Sanity-check and play again.

**Before the bundle is committed**, run the full suite — `npm test` — which covers every bundle under `fixtures/` automatically. That belongs to the commit, not to the story: it happens once the child has seen their story, not while they are waiting. If it goes red on something you can't place, that's a `story-create-debug` session.

## References

- `improv-troupe.md` → "Casting rules for the director", "Honest limits", "The sfx repertoire", "Layer stack" — read when a story strains the troupe, and when choosing cues.
- `improv-design.md` → "Where the delight comes from" — the ranked levers behind the choices above.
- `improv-storyboard.md` — one story cast two ways, with the horse/dragon problem worked through.
- `schema/performance.schema.json` + `tools/lib/validator.ts` — the contract; every validator error code is fixable at the authoring layer except a missing actor, which is a restructure conversation.
- `fixtures/meet-the-troupe/` — the worked example of a full-troupe cast, spoken overrides, and late-cue re-anchoring.
- `.claude/skills/story-create-debug/SKILL.md` — the same story work with the creation-time test pass and review gates.
