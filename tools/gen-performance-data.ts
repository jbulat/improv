// Emits a performance as the Lua `S.performance` table baked into a device app.
import { effectiveLayers, wornSlots } from "./lib/layers";
import type { Layers, Performance } from "./lib/types";

const FOLDS: [RegExp, string][] = [
  [/…/g, "..."],
  [/[—–]/g, "-"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
];

export function foldAscii(s: string): string {
  let out = s;
  for (const [re, to] of FOLDS) out = out.replace(re, to);
  if (!/^[\x20-\x7e]*$/.test(out)) {
    throw new Error(`non-ASCII text after folding: ${JSON.stringify(out)}`);
  }
  return out;
}

// JSON string escaping is a subset of valid Lua string escaping for ASCII text.
function luaStr(s: string): string {
  return JSON.stringify(foldAscii(s));
}

/** `{ headwear = "horns" }` — one layer set as a Lua table, slots sorted. */
function layersTable(layers: Layers): string {
  const worn = wornSlots(layers).sort(([a], [b]) => (a < b ? -1 : 1));
  if (!worn.length) return "{}";
  return `{ ${worn.map(([slot, id]) => `${slot} = ${luaStr(id)}`).join(", ")} }`;
}

export function emitPerformanceLua(perf: Performance, bundleName: string): string {
  const audio = new Map(perf.assets.audio.map((a) => [a.id, a]));
  const castByCharacter = new Map(perf.cast.map((c) => [c.character_id, c]));
  const lines: string[] = [];
  lines.push("S.performance = {");
  lines.push(`  title = ${luaStr(perf.title)},`);
  lines.push(`  audio_root = ${luaStr(`stories/${bundleName}`)},`);
  const clipIds = perf.assets.audio.map((a) => a.id).sort();
  lines.push(`  clips = { ${clipIds.map((id) => luaStr(id)).join(", ")} },`);
  lines.push("  cast = {");
  for (const c of perf.cast) {
    // Only a populated set is baked: a cast member with no layers gets no
    // `layers` field.
    const worn = wornSlots(c.layers);
    const layers = worn.length ? `, layers = ${layersTable(c.layers ?? {})}` : "";
    lines.push(
      `    [${luaStr(c.character_id)}] = { actor = ${luaStr(c.actor)}, name = ${luaStr(c.display_name)}, ` +
        `default_expression = ${luaStr(c.default_expression)}${layers} },`,
    );
  }
  lines.push("  },");
  lines.push("  beats = {");
  for (const b of perf.timeline) {
    const clip = b.line_audio ? audio.get(b.line_audio) : undefined;
    if (b.line_audio && !clip) throw new Error(`beat ${b.index}: unknown line_audio "${b.line_audio}"`);
    const lineMs = clip ? `, line = ${luaStr(clip.id)}, line_ms = ${clip.duration_ms}` : "";
    // A stable sort by at_ms, on a copy. The validator already rejects
    // out-of-order cues (SFX_OUT_OF_ORDER); sorting here too guarantees the
    // order player.lua needs, since its cue cursor (p.sfx_next) only advances.
    const sortedSfx = [...b.sfx].sort((x, y) => x.at_ms - y.at_ms);
    const sfx = sortedSfx.map((s) => `{ id = ${luaStr(s.audio)}, at = ${s.at_ms} }`).join(", ");
    // A beat that overrides layers bakes the RESOLVED set (cast merged with the
    // override), so the device never merges anything: it draws beat.layers when
    // the beat has them and the cast's otherwise. An override that strips the
    // last slot bakes as `{}` — empty but present, which is how "wears nothing
    // this beat" stays distinct from "no override" in a table-or-nil test.
    const layers = b.layers
      ? `, layers = ${layersTable(effectiveLayers(castByCharacter.get(b.character_id), b))}`
      : "";
    lines.push(
      `    { character = ${luaStr(b.character_id)}, expression = ${luaStr(b.expression)}, ` +
        `text = ${luaStr(b.text)}, duration = ${b.duration_ms}, animation = ${luaStr(b.animation)}` +
        `${lineMs}${layers}, sfx = { ${sfx} } },`,
    );
  }
  lines.push("  },");
  lines.push("}");
  return lines.join("\n") + "\n";
}
