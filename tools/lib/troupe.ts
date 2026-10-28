// The only code that loads troupe.json: shape-checks it against
// schema/troupe.schema.json and cross-checks its internal references, so a
// malformed troupe fails here with a clear message instead of surfacing as a
// confusing downstream validation error.
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv, { type AnySchema } from "ajv";
import { ROOT } from "./cli";
import type { Troupe } from "./types";

export const DEFAULT_TROUPE_PATH = path.join(ROOT, "troupe/troupe.json");

const schema = JSON.parse(readFileSync(path.join(ROOT, "schema/troupe.schema.json"), "utf8")) as AnySchema;

export function loadTroupe(troupePath: string = DEFAULT_TROUPE_PATH): Troupe {
  const raw: unknown = JSON.parse(readFileSync(troupePath, "utf8"));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "/"} ${e.message ?? "invalid"}`)
      .join("\n");
    throw new Error(`${troupePath} is not a valid troupe:\n${detail}`);
  }
  const troupe = raw as Troupe;

  // Every signature voice must exist in the voice catalog — the catalog is
  // what the Render stage (and the Director prompt) consume.
  const voiceIds = new Set(troupe.voices.map((v) => v.id));
  for (const a of [...troupe.actors, troupe.mc]) {
    if (!voiceIds.has(a.voice)) {
      throw new Error(`${troupePath}: "${a.id}" has signature voice "${a.voice}" not in voices`);
    }
  }

  // Every layer's fits list must name real actors or categories, and ids must
  // be unique per slot (the (slot, id) pair is what cast members reference).
  const fitTargets = new Set([...troupe.actors.map((a) => a.id), ...troupe.actors.map((a) => a.category)]);
  const seenLayers = new Set<string>();
  for (const l of troupe.layers) {
    const key = `${l.slot}/${l.id}`;
    if (seenLayers.has(key)) {
      throw new Error(`${troupePath}: duplicate layer "${l.id}" in slot "${l.slot}"`);
    }
    seenLayers.add(key);
    for (const f of l.fits) {
      if (!fitTargets.has(f)) {
        throw new Error(`${troupePath}: layer "${l.id}" fits "${f}" — not an actor id or category`);
      }
    }
  }
  return troupe;
}
