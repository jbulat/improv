# The Claude Code setup

In this prototype the skills here are part of the product, not only developer tooling. The
pipeline is Author, Direct, Validate, Render, Distribute and Play, and the two story skills
*are* the Author and Direct stages: they co-write a story with a child and cast it onto the
troupe. Plain code does the rest.

## The skills

| Skill | What it does |
|---|---|
| [`story-create`](skills/story-create/SKILL.md) | Turns a child's idea into a story: asks one to three questions, co-writes it, casts it, builds the bundle, checks it headlessly and plays it in the local simulator (or on the device with `--device`). |
| [`story-create-debug`](skills/story-create-debug/SKILL.md) | The same work with the full creation-time test pass, for developing and debugging the pipeline. |
| [`push-story`](skills/push-story/SKILL.md) | Delivers a built story to the StickS3 over the air. |

## Why two story skills

`story-create` optimises for one thing: the seconds between a child telling a story and seeing
it play. It has no approval gates and does not run the test suite; it shows the measured beat
table afterwards, as a record.

`story-create-debug` adds the gates: beat-table approval before building, the full test suite
(`npm test`), a simulator watch-through, and dual sign-off (the simulator run and the measured
`export:story` table).

Both pass the same validator. `build:app` runs it on every build and refuses any story with an
error, so the fast skill cannot ship a story the careful one would reject.

## How `push-story` delivers a story

It validates and builds the bundle, serves the story's audio over the local network, and
announces a `story_fetch` to the device through the Resident relay. It then watches the
server's log until the device has fetched every file and checked its size and CRC32, and only
then pushes the app with `/resident:push-app`. Audio never leaves the local network; only the
small announce goes through the relay. Its steps, verbatim from the skill:

```
### 1. Validate and build
### 2. Note the Mac's current LAN IP
### 3. Capture the manifest
### 4. Start the server
### 5. Prove the server is reachable, before announcing
### 6. Build the announce
### 7. Announce to each device
### 8. Watch the server log
### 9. Push the app
### 10. Stop the server and report
```

## Plugins

[`settings.json`](settings.json) enables two plugins:

- **Resident** (`resident@inanimate`), for the device: validating and pushing Lua apps to the
  StickS3 (`/resident:validate-app`, `/resident:push-app`). It reads the repo-root
  [`DEVICE-SKILL.md`](../DEVICE-SKILL.md) to know the device's Lua surface.
- **Superpowers** (`superpowers@claude-plugins-official`,
  [obra/superpowers](https://github.com/obra/superpowers)), for the development loop.

A cloud session may not install Superpowers by itself, because it comes from an external
source; install it there by hand if you need it.
