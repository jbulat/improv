import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Ajv, { type AnySchema } from "ajv";
import { wavDurationMs } from "./wav";
import { referencedAudioIds } from "./timeline";
import { staysInBundle } from "./bundle";
import type { Layers, Performance, Troupe } from "./types";

const schema = JSON.parse(
  readFileSync(new URL("../../schema/performance.schema.json", import.meta.url), "utf8"),
) as AnySchema;

export interface Issue {
  level: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export interface ValidateOptions {
  checkFilesDir?: string;
}

/**
 * A build/pack-ready error report: one indented line per error, each led by
 * its code so the failure is greppable and the author knows the rule by name.
 */
export function formatValidationErrors(bundleName: string, result: ValidationResult): string {
  const detail = result.errors.map((e) => `  [${e.code}] ${e.path} ${e.message}`).join("\n");
  return `${bundleName} failed validation:\n${detail}`;
}

const DURATION_TOLERANCE_MS = 100;

export function validatePerformance(
  perf: unknown,
  troupe: Troupe,
  opts: ValidateOptions = {},
): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const error = (code: string, at: string, message: string) =>
    errors.push({ level: "error", code, path: at, message });
  const warn = (code: string, at: string, message: string) =>
    warnings.push({ level: "warning", code, path: at, message });

  const ajv = new Ajv({ allErrors: true });
  const validateShape = ajv.compile(schema);
  if (!validateShape(perf)) {
    for (const e of validateShape.errors ?? []) {
      error("SHAPE", e.instancePath || "/", `${e.message ?? "invalid"} ${JSON.stringify(e.params)}`);
    }
    // Semantic checks assume a well-shaped document; stop here.
    return { ok: false, errors, warnings };
  }
  const p = perf as Performance;

  const mcId = troupe.mc.id;
  const troupeActorIds = new Set(troupe.actors.map((a) => a.id));
  // null means "unknown actor" (already reported) — skip expression checks
  const allowedExpressions = (actor: string): string[] | null =>
    actor === mcId
      ? troupe.expressions.miss_moon
      : troupeActorIds.has(actor)
        ? troupe.expressions.base
        : null;

  const voiceByActor = new Map<string, string>([
    [mcId, troupe.mc.voice],
    ...troupe.actors.map((a) => [a.id, a.voice] as [string, string]),
  ]);

  const layerCatalog = new Map(troupe.layers.map((l) => [`${l.slot}/${l.id}`, l]));
  const categoryByActor = new Map(troupe.actors.map((a) => [a.id, a.category]));

  // Layers are checked identically wherever they are authored: on a cast entry
  // (worn throughout) or on a beat (worn for that beat only). Both resolve
  // against the same catalog and the same wearer — the beat's actor.
  const checkLayers = (layers: Layers | undefined, actor: string, at: string) => {
    for (const [slot, id] of Object.entries(layers ?? {})) {
      if (id == null) continue;
      const item = layerCatalog.get(`${slot}/${id}`);
      if (!item) {
        error("UNKNOWN_LAYER", `${at}/${slot}`, `"${id}" is not a ${slot} layer in the troupe catalog`);
      } else if (actor === mcId || troupeActorIds.has(actor)) {
        // fits lists actor ids and/or categories; miss_moon has no category
        // (and wears no layers), so only an explicit id entry could fit her.
        const category = categoryByActor.get(actor);
        if (!item.fits.includes(actor) && !(category && item.fits.includes(category))) {
          error(
            "LAYER_MISFIT",
            `${at}/${slot}`,
            `layer "${id}" fits [${item.fits.join(", ")}], not actor "${actor}"`,
          );
        }
      }
    }
  };

  // --- cast checks ---
  const castByCharacter = new Map<string, Performance["cast"][number]>();
  const actorHolder = new Map<string, string>();
  for (const [i, c] of p.cast.entries()) {
    const at = `/cast/${i}`;
    if (castByCharacter.has(c.character_id)) {
      error("DUPLICATE_CHARACTER", at, `duplicate character_id "${c.character_id}"`);
    } else {
      castByCharacter.set(c.character_id, c);
    }
    if (c.actor !== mcId && !troupeActorIds.has(c.actor)) {
      error("UNKNOWN_ACTOR", `${at}/actor`, `"${c.actor}" is not a troupe actor`);
    }
    if (c.character_id === mcId && c.actor !== mcId) {
      error("MISS_MOON_MISCAST", at, `the ${mcId} role must be played by the ${mcId} actor`);
    }
    if (c.character_id !== mcId && c.actor === mcId) {
      error("MISS_MOON_MISCAST", at, `${mcId} never plays a story role (got role "${c.character_id}")`);
    }
    const held = actorHolder.get(c.actor);
    if (held !== undefined) {
      error(
        "ACTOR_DOUBLED",
        `${at}/actor`,
        `actor "${c.actor}" already plays "${held}" — one role per actor`,
      );
    } else {
      actorHolder.set(c.actor, c.character_id);
    }
    const allowed = allowedExpressions(c.actor);
    if (allowed && !allowed.includes(c.default_expression)) {
      error(
        "BAD_EXPRESSION",
        `${at}/default_expression`,
        `"${c.default_expression}" is not an expression of actor "${c.actor}"`,
      );
    }
    // Voice is a property of the actor, not the role: the troupe's charm is
    // recognising the same actor across stories.
    const signature = voiceByActor.get(c.actor);
    if (signature !== undefined && c.voice !== signature) {
      error(
        "VOICE_NOT_SIGNATURE",
        `${at}/voice`,
        `actor "${c.actor}" always speaks with "${signature}", got "${c.voice}"`,
      );
    }
    checkLayers(c.layers, c.actor, `${at}/layers`);
  }
  if (!p.cast.some((c) => c.character_id === mcId && c.actor === mcId)) {
    error("MISS_MOON_MISSING", "/cast", `every performance must cast ${mcId} as host`);
  }

  // --- audio asset checks ---
  // Tools that stage or pack a bundle join each local uri onto the bundle
  // directory and look assets up by id, so both must be unambiguous.
  const seenAudioIds = new Set<string>();
  for (const [i, a] of p.assets.audio.entries()) {
    if (seenAudioIds.has(a.id)) {
      error("DUPLICATE_AUDIO_ID", `/assets/audio/${i}/id`, `duplicate audio id "${a.id}"`);
    }
    seenAudioIds.add(a.id);
    if (!a.uri.includes("://") && !staysInBundle(a.uri)) {
      error(
        "AUDIO_URI_OUTSIDE_BUNDLE",
        `/assets/audio/${i}/uri`,
        `"${a.uri}" is not a path inside the bundle`,
      );
    }
  }

  // --- beat checks ---
  const audioById = new Map(p.assets.audio.map((a) => [a.id, a]));
  const sfxVocabulary = new Set(troupe.sfx_vocabulary);
  for (const [i, b] of p.timeline.entries()) {
    const at = `/timeline/${i}`;
    if (b.index !== i) {
      error("BAD_INDEX", `${at}/index`, `expected contiguous index ${i}, got ${b.index}`);
    }
    const cm = castByCharacter.get(b.character_id);
    if (!cm) {
      error("UNKNOWN_CHARACTER", `${at}/character_id`, `"${b.character_id}" is not in the cast`);
    } else {
      const allowed = allowedExpressions(cm.actor);
      if (allowed && !allowed.includes(b.expression)) {
        error(
          "BAD_EXPRESSION",
          `${at}/expression`,
          `"${b.expression}" is not an expression of actor "${cm.actor}"`,
        );
      }
      checkLayers(b.layers, cm.actor, `${at}/layers`);
    }
    if (b.line_audio !== null) {
      const a = audioById.get(b.line_audio);
      if (!a) {
        error("BAD_AUDIO_REF", `${at}/line_audio`, `"${b.line_audio}" is not in assets.audio`);
      } else {
        if (a.kind !== "line") {
          error(
            "BAD_AUDIO_KIND",
            `${at}/line_audio`,
            `"${b.line_audio}" has kind "${a.kind}", expected "line"`,
          );
        } else if (a.duration_ms > b.duration_ms) {
          warn(
            "DURATION_SHORT",
            `${at}/duration_ms`,
            `beat lasts ${b.duration_ms}ms but its line clip is ${a.duration_ms}ms`,
          );
        }
      }
    }
    if (b.animation === "speak" && b.line_audio === null) {
      error("SPEAK_WITHOUT_AUDIO", `${at}/animation`, `animation "speak" requires line_audio`);
    }
    for (const [j, s] of b.sfx.entries()) {
      const sfxAt = `${at}/sfx/${j}`;
      const a = audioById.get(s.audio);
      if (!a) {
        error("BAD_AUDIO_REF", `${sfxAt}/audio`, `"${s.audio}" is not in assets.audio`);
      } else {
        if (a.kind !== "sfx") {
          error("BAD_AUDIO_KIND", `${sfxAt}/audio`, `"${s.audio}" has kind "${a.kind}", expected "sfx"`);
        } else if (!sfxVocabulary.has(a.id)) {
          error("SFX_NOT_IN_VOCABULARY", `${sfxAt}/audio`, `"${a.id}" is not in the troupe's sfx_vocabulary`);
        }
      }
      // A cue inside the beat is all one snapshot can establish. A cue that a
      // re-rendered clip has mistimed is reported at render time
      // (tools/lib/cue-drift.ts).
      if (s.at_ms >= b.duration_ms) {
        error(
          "SFX_PAST_END",
          `${sfxAt}/at_ms`,
          `sfx cued at ${s.at_ms}ms but the beat lasts ${b.duration_ms}ms`,
        );
      }
      // player.lua walks each beat's cues with a monotonic cursor, so the
      // contract requires ascending order (the emitter also normalizes, but
      // the fixture on disk should already say what the runtime needs).
      if (j > 0 && s.at_ms < b.sfx[j - 1].at_ms) {
        error(
          "SFX_OUT_OF_ORDER",
          `${sfxAt}/at_ms`,
          `sfx cued at ${s.at_ms}ms after a cue at ${b.sfx[j - 1].at_ms}ms — cues must ascend by at_ms`,
        );
      }
    }
    if (b.device !== undefined && !p.stage.devices.includes(b.device)) {
      error("UNKNOWN_DEVICE", `${at}/device`, `"${b.device}" is not in stage.devices`);
    }
  }

  // --- stage + orphan checks ---
  if (!p.stage.devices.includes(p.stage.default_device)) {
    error("UNKNOWN_DEVICE", "/stage/default_device", `"${p.stage.default_device}" is not in stage.devices`);
  }
  const referencedAudio = referencedAudioIds(p.timeline);
  for (const [i, a] of p.assets.audio.entries()) {
    if (!referencedAudio.has(a.id)) {
      warn("ORPHAN_AUDIO", `/assets/audio/${i}`, `"${a.id}" is never referenced by the timeline`);
    }
  }

  // --- file checks (bundle-relative URIs only) ---
  if (opts.checkFilesDir) {
    for (const [i, a] of p.assets.audio.entries()) {
      if (a.uri.includes("://")) continue; // flash:// and https:// are not local files
      if (!staysInBundle(a.uri)) continue; // reported above; never read outside the bundle
      const fp = path.join(opts.checkFilesDir, a.uri);
      if (!existsSync(fp)) {
        error(
          "AUDIO_FILE_MISSING",
          `/assets/audio/${i}/uri`,
          `${a.uri} not found under ${opts.checkFilesDir}`,
        );
        continue;
      }
      const actual = wavDurationMs(readFileSync(fp));
      if (Math.abs(actual - a.duration_ms) > DURATION_TOLERANCE_MS) {
        error(
          "AUDIO_DURATION_MISMATCH",
          `/assets/audio/${i}/duration_ms`,
          `manifest says ${a.duration_ms}ms, file is ${actual}ms`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
