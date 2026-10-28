# Design decisions

The ten decisions that shaped Improv, and why each was made. Each feature was designed before it
was built; this page keeps the reasoning and drops the working documents.

## 1. Cast stories onto a fixed troupe; never generate pixels

Every story is performed by the same six actors (`bruno`, `milo`, `ada`, `rosa`, `pip`, `tuk`)
and one host, Miss Moon. The AI director *casts* a story onto them; it never draws anything. This
turns an open-ended generation problem into a small, checkable one: the director's output is a
list of ids, and every id either exists in [`troupe/troupe.json`](troupe/troupe.json) or it does
not. It also suits the audience. A child recognises the troupe from story to story, the way they
recognise a puppet company, and project-specific pixel art on a 135×240 screen stays legible and charming
where generated art would not. When a story wants something the troupe lacks, the rule is to
restructure the staging first (the dragon flies everyone home, instead of needing a horse).

## 2. The beat timeline is the contract, and a deterministic validator guards it

Everything compiles to one `Performance` JSON: the cast, the assets, and an ordered list of beats
(who is on screen, their expression, the line and its clip, the sound-effect cues, the duration).
Its shape is a JSON Schema ([`schema/performance.schema.json`](schema/performance.schema.json)),
and its meaning is checked by [`tools/lib/validator.ts`](tools/lib/validator.ts): 25 rules (23 errors
and 2 warnings), from an unknown actor to a sound cue past the end of its beat. The validator is plain code, kept apart from
any model, so a failure is always the same failure and always has a name. `build:app` refuses a
story with an error, and [`fixtures/invalid/`](fixtures/invalid/) holds a broken Performance for every
error rule except the two that read audio files, so the rules are documented by examples that the
tests run.

## 3. One actor, one role, because voice is identity

An actor plays at most one role in a story, so a story has at most six roles plus the host. The
rule was relaxed once: when costumes and props arrived, a doubled actor could be *dressed* apart,
so doubling was allowed if the two roles differed in at least one layer. It was then reinstated,
because layers solve only half the problem. Each actor has one signature voice, and a child
recognises a character by body and voice together. A dressed-apart double still sounds like one
character, and per-role voice changes do not exist. The validator enforces the rule as
`ACTOR_DOUBLED`.

## 4. Roles are dressed by paper-doll layers, with the limits declared in the data

A role is an actor plus optional layers, drawn back to front: back prop, body, costume,
expression, headwear, front prop. Each layer item says which actors it `fits`, and it is placed by
an anchor on the actor (the face box for headwear, the hand for a sword), so one authored crown
fits every human head. Two checks keep this honest. The screen bound is measured on the *inked*
pixels of the art on each actor, not on the 32×32 authoring grid, so the same wings can be legal on
Rosa and illegal on Tuk. And when art is meant to run off the screen, it must say so: butterfly
wings declare a horizontal `bleed_x`, and vertical bleed is never allowed. Detail level is
declared per item as well (`density: 2` for finer art), so low- and high-resolution art can live
side by side without a flag day.

## 5. Audio drives time

Every line is rendered to a clip before playback, and each beat's duration is *measured* from its
clip, not typed by an author. So narration and pictures agree by construction, and a beat boundary
restarts the clip, which keeps errors from adding up. The format is 16 kHz mono 16-bit PCM WAV:
small enough that a whole story (about 1.7 MB) preloads into the device's 8 MB of PSRAM, and simple
enough that the device needs no decoder. Preloading matters more than size: a flash read at each
beat change would show as a visible stall. The device parses the WAV header itself, because
`afconvert` puts a padding chunk where a naive reader expects the data.

## 6. The simulator runs the app that ships, not a copy of it

`npm run sim` runs the exact `.device.lua` file that the StickS3 runs, in a real `lua` process,
against a Node implementation of the device's screen, buttons and audio. A second player written
in TypeScript would have been quicker to build and would have tested the wrong thing. Node owns
the clock and the playback state, so the same run works with a browser panel or fully headless in
the test suite. In the browser panel it uses real frame times, because a perfect 100 ms tick hides
the drift worth finding. The screen is rasterised in Node, so the art contact sheets and the video export
(`npm run export:video`, on a virtual clock) share the same pixels. Storage is *not* emulated: a
fake flash budget would only test the fake, so the hardware stays the authority on eviction and
space.

## 7. Troupe art lives in the firmware; layer art travels with each story

At first every story app carried its own copy of the actors' art, and the app that cast all seven
reached 68,748 bytes, too big for the device to receive (it ran out of memory and dropped it). The troupe is closed by design, so its
art is platform data: it now compiles into the firmware (`TroupeArtData.h`, generated from the
sprite grids), and story apps fell to about 15–27 KB. The layer catalog is open by design, since
stories keep adding hats and props, so layer art stays in each app. The firmware stores the same
Lua text that the build tools emit, so no new encoding or decoder exists to drift. A CRC32
fingerprint of the art is baked into every app, and an app built against different art refuses to
run, with a readable message on the screen instead of garbled sprites.

## 8. Story audio moves over the local network; only a small announce uses the relay

A story's audio is about 1.7 MB, which is far too much to push through a relay built for small
Lua apps. So the Mac serves the bundle over HTTP on the local network
([`tools/serve-bundle.ts`](tools/serve-bundle.ts)), and only a small JSON `story_fetch` announce
goes through the relay. The device pulls each file, checks its size and CRC32, writes into a
temporary folder, and publishes the story with a rename. It keeps several stories and evicts the
oldest when space runs short, so the author never thinks about the flash budget. The app itself
still travels the way it already did, pushed over the relay; only the audio needed a new path.
`WORKFLOWS.md` lists what this prototype does not handle, such as authentication
([Known limits of delivery](WORKFLOWS.md#known-limits-of-delivery)).

## 9. The device keeps working with no network

A child takes the device somewhere without WiFi and turns it on. It should still play the last
story. Resident can restore the last app at boot, but its default store is the 20 KB NVS partition,
which it shares with the WiFi settings, and the apps were larger than that. So the firmware
injects its own store, which keeps the app as a file on LittleFS. It writes to a temporary file
and renames it, so a flat battery during a save cannot leave a half-written app, and it skips a
save when the content has not changed, so a reboot does not rewrite flash every time.

## 10. The AI co-author is a skill, and the story stays the child's

In this prototype the Author and Director stages are Claude Code skills
([`.claude/skills/story-create/`](.claude/skills/story-create/SKILL.md)), not a cloud service. The
skill is built around one clock: the seconds between a child telling a story and seeing it play.
So it has no approval gates on the fast path. It asks one to three questions, one at a time, to
draw out the child's idea, then fills the remaining gaps itself and builds the story. The child's
own names and ideas are kept as given. Content is checked first, not last: every story must suit
a five-year-old at bedtime, and this applies to the child's idea before any work starts. A second
skill, `story-create-debug`, does the same work with review gates and the full test pass, for
developing the pipeline rather than telling a story.
