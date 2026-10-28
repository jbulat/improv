// Builds a device app (the story player, or the art viewer) into one Lua file
// under device-apps/improv/build/.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  layerAnchor,
  loadPalette,
  loadActor,
  loadLayerArt,
  type ActorSprites,
  type LayerArt,
} from "./lib/sprites";
import { loadBundle } from "./lib/bundle";
import { ROOT, UsageError, parseCli, runCli } from "./lib/cli";
import { loadTroupe } from "./lib/troupe";
import { emitHandAnchorsLua, emitLayerArtLua, troupeArtFingerprint } from "./gen-sprite-data";
import { loadAllActors } from "./gen-troupe-header";
import { emitPerformanceLua } from "./gen-performance-data";
import { effectiveLayers, wornSlots } from "./lib/layers";
import {
  actorScale,
  describeViolation,
  overflowViolation,
  screenOverflow,
  SCREEN_H,
  SCREEN_W,
} from "./lib/placement";
import { formatValidationErrors, validatePerformance } from "./lib/validator";
import type { Layers, Performance } from "./lib/types";

export type Entry = "player" | "viewer";

const CHUNKS: Record<Entry, string[]> = {
  viewer: ["compositor.lua", "viewer.lua"],
  player: ["compositor.lua", "audio.lua", "player.lua", "main.lua"],
};

/** Every actor with authored art. The viewer browses all of it. */
function spriteActorIds(): string[] {
  return readdirSync(path.join(ROOT, "sprites/actors"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function checkArtCoverage(perf: Performance, actors: ActorSprites[], layers: LayerArt[] = []): void {
  const byId = new Map(actors.map((a) => [a.id, a]));
  const cast = new Map(perf.cast.map((c) => [c.character_id, c]));
  for (const beat of perf.timeline) {
    const member = cast.get(beat.character_id)!;
    const art = byId.get(member.actor);
    if (!art) throw new Error(`beat ${beat.index}: no sprite art for actor "${member.actor}"`);
    for (const expr of [beat.expression, member.default_expression]) {
      if (!art.expr[`${expr}_closed`]) {
        throw new Error(`beat ${beat.index}: actor "${member.actor}" has no overlay for "${expr}"`);
      }
    }
  }
  // Every worn layer must have art that lands on the 135x240 screen once
  // anchored and scaled (the compositor's math), so a misfit fails the build.
  // The bound is the screen, not the 32x32 cell: a back_prop anchors above the
  // wearer by design. Beats are checked as drawn, with their overrides merged.
  const layerByKey = new Map(layers.map((l) => [`${l.slot}/${l.id}`, l]));
  const checkWorn = (worn: Layers, actor: string, who: string) => {
    for (const [slot, id] of wornSlots(worn)) {
      const item = layerByKey.get(`${slot}/${id}`);
      if (!item) throw new Error(`${who}: no layer art for ${slot} "${id}"`);
      const art = byId.get(actor);
      if (!art) throw new Error(`${who}: no sprite art for actor "${actor}"`);
      const anchor = layerAnchor(art, item, actorScale(actor));
      const over = screenOverflow(actor, art.base, anchor, item.grid);
      const violation = overflowViolation(over, item.bleedX);
      if (violation) {
        throw new Error(
          `${who}: ${slot} "${id}" (${item.w}x${item.h}) on actor "${actor}" is clipped by the ` +
            `${SCREEN_W}x${SCREEN_H} screen — ${describeViolation(violation, item.bleedX)}`,
        );
      }
    }
  };
  for (const member of perf.cast) {
    checkWorn(member.layers ?? {}, member.actor, `cast "${member.character_id}"`);
  }
  for (const beat of perf.timeline) {
    if (!beat.layers) continue;
    const member = cast.get(beat.character_id)!;
    checkWorn(effectiveLayers(member, beat), member.actor, `beat ${beat.index}`);
  }
}

// Assets the player itself requires beyond what the timeline references:
// player_reset() fires sfx_chime on the title/restart, so every bundle must
// ship it — the Performance contract alone doesn't promise it.
export function checkAppAssets(perf: Performance): void {
  const chime = perf.assets.audio.find((a) => a.id === "sfx_chime");
  if (!chime || chime.kind !== "sfx") {
    throw new Error('the player needs an "sfx_chime" sfx asset (player_reset\'s title chime)');
  }
}

// Device apps carry no actor art: the firmware does (TroupeArtData.h). The
// prelude installs the cast from that resident set once the firmware's art
// fingerprint matches this build's. On any failure it sets S.art_error, which
// the entry chunk (main.lua or viewer.lua) draws via S.draw_art_error.
function emitTroupePrelude(fingerprint: string, castActorIds: string[]): string {
  const ids = castActorIds.map((id) => `"${id}"`).join(", ");
  return `-- resident troupe art (device/lib/drivers/src/TroupeArtData.h)
local want_art = "${fingerprint}"
if type(troupe) ~= "table" then
  S.art_error = "This story needs newer\\nfirmware (resident art\\n" .. want_art .. ").\\nReflash the device."
elseif troupe.fingerprint() ~= want_art then
  S.art_error = "Art set mismatch.\\nStory wants " .. want_art .. "\\nfirmware has " .. troupe.fingerprint() .. ".\\nRebuild or reflash."
else
  local install_ok, install_err = pcall(troupe.install, S, { ${ids} })
  if not install_ok then
    S.art_error = "Resident art install\\nfailed:\\n" .. tostring(install_err)
  end
end
`;
}

/** Remove every Lua comment from `src`, leaving the code and its line numbers.
 *
 *  A lexical scan, not a line-based `--` strip, because baked story text may
 *  contain `--`. It keeps code, short strings (either quote, with backslash
 *  escapes), long brackets and comments apart; only `--` in code starts a
 *  comment. Every newline is kept, so a device traceback names the right line.
 *  Whitespace is trimmed only where a comment was removed, so layer-art long
 *  strings are untouched. */
export function stripLuaComments(src: string): string {
  const n = src.length;

  // A long bracket opens with `[`, any number of `=`, then `[`; that count is
  // its level, and only `]` + the same count + `]` closes it. That is what lets
  // a level-1 grid hold a `]]` and a level-2 string hold a `--[[`.
  const openLevel = (p: number): number => {
    if (src[p] !== "[") return -1;
    let k = p + 1;
    while (src[k] === "=") k++;
    return src[k] === "[" ? k - p - 1 : -1;
  };
  const afterClose = (p: number, level: number): number => {
    const at = src.indexOf(`]${"=".repeat(level)}]`, p);
    // Unterminated. Lua would reject the chunk and buildApp's compile check
    // will say so; consume the rest rather than rescanning it as code.
    return at === -1 ? n : at + level + 2;
  };

  let out = "";
  let kept = 0; // start of the code not yet copied into `out`
  let i = 0;
  while (i < n) {
    const c = src[i];

    if (c === "-" && src[i + 1] === "-") {
      const start = i;
      i += 2;
      const level = openLevel(i);
      if (level === -1) {
        while (i < n && src[i] !== "\n") i++;
      } else {
        i = afterClose(i + level + 2, level);
      }
      // Back over the whitespace that led into the comment, so a stripped
      // trailing comment leaves no ragged edge and a comment-only line leaves
      // no indentation to nowhere. This stops at the newline on its own.
      let from = start;
      while (from > kept && (src[from - 1] === " " || src[from - 1] === "\t")) from--;
      out += src.slice(kept, from) + src.slice(start, i).replace(/[^\n]/g, "");
      kept = i;
      continue;
    }

    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") i++; // an escaped anything, the closing quote included
        i++;
      }
      i++;
      continue;
    }

    const level = openLevel(i);
    i = level === -1 ? i + 1 : afterClose(i + level + 2, level);
  }
  return out + src.slice(kept);
}

/** Compose an app's source and its output path, without writing it. Pure, so
 *  a test can compare a committed artifact with fresh output without racing
 *  other tests that build the same bundle. Validation runs here; the `lua`
 *  compile check needs a file on disk, so it stays in buildApp. */
export function buildAppSource(
  entry: Entry = "player",
  bundleDir?: string,
): { source: string; outPath: string } {
  const palette = loadPalette(path.join(ROOT, "sprites/palette.json"));

  // The player bakes exactly the story's cast; the viewer bakes every actor
  // with art. Neither is a hand-maintained list that can disagree with reality.
  let actorIds: string[];
  let bundleName = "viewer";
  let perf: Performance | undefined;
  if (entry === "player") {
    if (!bundleDir) throw new Error("buildApp('player') requires a bundle dir");
    const bundle = loadBundle(bundleDir);
    perf = bundle.perf;
    bundleName = bundle.name;
    actorIds = [...new Set(perf.cast.map((c) => c.actor))].sort();
  } else {
    actorIds = spriteActorIds();
  }

  // Validate before touching art: an unknown actor or layer id should surface
  // as its named validation error (UNKNOWN_ACTOR, UNKNOWN_LAYER, ...), not a
  // raw ENOENT when loadActor/loadLayerArt reaches for a file that isn't there.
  // checkFilesDir: the baked line_ms/duration values must match the WAVs that
  // will actually be staged, or resume sync silently degrades.
  if (perf) {
    const result = validatePerformance(perf, loadTroupe(), { checkFilesDir: bundleDir! });
    if (!result.ok) throw new Error(formatValidationErrors(bundleName, result));
  }

  const actors = actorIds.map((id) => loadActor(path.join(ROOT, "sprites/actors", id), palette));

  // The player bakes exactly the layers the story wears — the cast's costumes
  // plus anything a beat reveals (the viewer browses actors only; layer art
  // review lives in preview-art --headwear).
  const layersDir = path.join(ROOT, "sprites/layers");
  const wornKeys = [
    ...new Set(
      [...(perf?.cast ?? []), ...(perf?.timeline ?? [])].flatMap((x) =>
        wornSlots(x.layers).map(([slot, id]) => `${slot}/${id}`),
      ),
    ),
  ].sort();
  const layers = wornKeys.map((key) => {
    const [slot, id] = key.split("/");
    return loadLayerArt(layersDir, slot, id, palette);
  });

  const parts = ["S = {}\n"];
  const all = loadAllActors();
  parts.push(emitTroupePrelude(troupeArtFingerprint(all.actors, all.palette), actorIds));
  parts.push(emitLayerArtLua(layers));

  if (layers.some((l) => l.slot === "front_prop")) {
    parts.push(emitHandAnchorsLua(actors));
  }

  if (perf) {
    checkArtCoverage(perf, actors, layers);
    checkAppAssets(perf);
    parts.push(emitPerformanceLua(perf, bundleName));
  }

  for (const chunk of CHUNKS[entry]) {
    const file = path.join(ROOT, "device-apps/improv/src", chunk);
    parts.push(`-- ==== src/${chunk} ====\n` + readFileSync(file, "utf8"));
  }

  // Player apps are named <bundle>.device.lua: the committed artifacts, the
  // push tooling and the on-device story index all expect that name.
  const suffix = entry === "player" ? ".device" : "";
  // Comments are about 8.5 KB of every bundle. The app reaches the device as
  // one JSON message that Courier parses into a heap document, so each comment
  // byte counts against the free heap that decides whether a story arrives
  // (see the size bound in tests/build-app.test.ts). Stripped over the joined
  // source so generated Lua is covered too; the provenance header goes back on.
  return {
    source: "-- generated by tools/build-app.ts -- do not edit\n" + stripLuaComments(parts.join("\n")),
    outPath: path.join(ROOT, "device-apps/improv/build", `${bundleName}${suffix}.lua`),
  };
}

export function buildApp(entry: Entry = "player", bundleDir?: string): { outPath: string; bytes: number } {
  const { source, outPath } = buildAppSource(entry, bundleDir);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, source);
  execFileSync("lua", ["-e", `assert(loadfile(${JSON.stringify(outPath)}))`]);
  return { outPath, bytes: Buffer.byteLength(source) };
}

const USAGE = [
  "usage: npm run build:app -- --bundle <dir>     (a story's player)",
  "       npm run build:app -- --entry viewer     (the art viewer)",
].join("\n");

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: USAGE,
    options: {
      entry: { type: "string", choices: ["player", "viewer"], default: "player" },
      bundle: { type: "string" },
    },
    removed: {
      target: "--target was removed: every app builds for the device (the local sim runs the same build)",
    },
  });
  const { entry, bundle } = values;
  if (entry === "player" && bundle === undefined) throw new UsageError("--bundle is required", USAGE);
  const { outPath, bytes } = buildApp(entry, entry === "player" ? bundle : undefined);
  console.log(`${path.relative(ROOT, outPath)} (${bytes} bytes)`);
}

runCli(import.meta.url, main);
