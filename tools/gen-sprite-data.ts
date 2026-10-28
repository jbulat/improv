// Emits sprite art as Lua, for device apps and the firmware's art header.
import type { ActorSprites, LayerArt, Palette } from "./lib/sprites";
import { crc32Hex } from "./lib/crc32";

// The body emitters are shared by emitSpritesLua and the firmware header
// chunks (emitActorChunk / emitPaletteChunk), so the two cannot drift.
// emitSpritesLua has no production consumer: tests/gen-troupe-header.test.ts
// uses it to prove the per-actor chunks compose to the same tables.
function paletteBody(palette: Palette): string[] {
  const lines: string[] = [];
  for (const ch of Object.keys(palette).sort()) {
    const { r, g, b } = palette[ch];
    lines.push(`  ${ch} = {${r},${g},${b}},`);
  }
  return lines;
}

function actorBody(a: ActorSprites): string[] {
  const lines: string[] = [];
  lines.push(`    face = { x=${a.face.x}, y=${a.face.y}, w=${a.face.w}, h=${a.face.h} },`);
  lines.push(`    base = [[\n${a.base.join("\n")}]],`);
  lines.push("    expr = {");
  for (const name of Object.keys(a.expr).sort()) {
    lines.push(`      ${name} = [[\n${a.expr[name].join("\n")}]],`);
  }
  lines.push("    },");
  return lines;
}

function layerArtLines(layers: LayerArt[]): string[] {
  const lines: string[] = [];
  // Layer art bakes only what the bundle's cast wears, grouped by slot.
  lines.push("S.layer_art = {");
  for (const slot of [...new Set(layers.map((l) => l.slot))].sort()) {
    lines.push(`  ${slot} = {`);
    for (const l of layers.filter((x) => x.slot === slot).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      lines.push(
        `    ${l.id} = { dx=${l.dx}, dy=${l.dy}, density=${l.density}, grid = [[\n${l.grid.join("\n")}]] },`,
      );
    }
    lines.push("  },");
  }
  lines.push("}");
  return lines;
}

/** The standalone S.layer_art block — the device app emits this even though
 *  actor art is resident, because layer art stays app-delivered. */
export function emitLayerArtLua(layers: LayerArt[]): string {
  return layerArtLines(layers).join("\n") + "\n";
}

/** `S.hand = { milo = { x = 21, y = 23 }, ... }` — the cast's hand anchors,
 *  for bundles that bake a front_prop (the one slot that reads them).
 *  App-delivered because a hand is placement metadata, not art: it stays out
 *  of the firmware fingerprint, so a hand tweak needs no reflash. */
export function emitHandAnchorsLua(actors: ActorSprites[]): string {
  const withHand = actors.filter((a) => a.hand).sort((x, y) => (x.id < y.id ? -1 : 1));
  const entries = withHand.map((a) => `${a.id} = { x = ${a.hand!.x}, y = ${a.hand!.y} }`);
  return `S.hand = { ${entries.join(", ")} }\n`;
}

/** Lua expression `return {...}` for the palette — the firmware's kPaletteChunk. */
export function emitPaletteChunk(palette: Palette): string {
  return ["return {", ...paletteBody(palette), "}"].join("\n") + "\n";
}

/** Lua expression `return {...}` for one actor — the firmware's per-actor chunk. */
export function emitActorChunk(a: ActorSprites): string {
  return ["return {", ...actorBody(a), "}"].join("\n") + "\n";
}

/** CRC32 (8 lowercase hex) over the canonical chunks: palette, then every
 *  actor in sorted-id order. Compiled into firmware and baked into device
 *  apps; equality means "same art set". Each chunk is hashed after its actor
 *  id and a separator the chunk cannot contain, so renaming an actor changes
 *  the fingerprint. Not done in emitActorChunk, whose output the firmware
 *  header and the Lua test stub depend on byte for byte. */
export function troupeArtFingerprint(actors: ActorSprites[], palette: Palette): string {
  const sorted = [...actors].sort((x, y) => (x.id < y.id ? -1 : 1));
  const canon = emitPaletteChunk(palette) + sorted.map((a) => `${a.id}\0${emitActorChunk(a)}`).join("");
  return crc32Hex(new TextEncoder().encode(canon));
}

export function emitSpritesLua(actors: ActorSprites[], palette: Palette, layers: LayerArt[] = []): string {
  const lines: string[] = [];
  lines.push("S.palette = {");
  lines.push(...paletteBody(palette));
  lines.push("}");
  lines.push(...layerArtLines(layers));
  lines.push("S.sprites = {");
  for (const a of actors) {
    lines.push(`  ${a.id} = {`);
    lines.push(...actorBody(a));
    lines.push("  },");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
