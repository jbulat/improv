// Emit a bundle's timeline as a flat table for human review / debugging:
// one row per beat, columns { beat, seconds, actor, role, text, expression,
// sfx, layers }. Markdown by default (paste-into-a-PR friendly); --csv for
// spreadsheets.
//
//   npm run export:story -- --bundle fixtures/knight-and-lonely-dragon [--csv]
import { loadBundle } from "./lib/bundle";
import { parseCli, runCli } from "./lib/cli";
import { effectiveLayers } from "./lib/layers";
import type { LayerSlot, Performance } from "./lib/types";

// Back-to-front, matching the compositor's draw order, so the column reads the
// way the screen stacks.
const SLOT_ORDER: readonly LayerSlot[] = ["back_prop", "costume", "headwear", "front_prop"];

export const COLUMNS = ["beat", "seconds", "actor", "role", "text", "expression", "sfx", "layers"] as const;

export interface Row {
  beat: number;
  seconds: string; // duration_ms as fixed 2dp seconds
  actor: string; // troupe body (milo, tuk, ...)
  role: string; // the character in this story (cast display_name)
  text: string;
  expression: string;
  sfx: string; // "sfx_whoosh@0.4s; ..." or "" when none
  layers: string; // "headwear=crown; ..." or "" when the role wears nothing
}

/** One row per beat, resolving character_id -> cast actor + display name. */
export function buildRows(perf: Performance): Row[] {
  const cast = new Map(perf.cast.map((c) => [c.character_id, c]));
  return perf.timeline.map((beat) => {
    const member = cast.get(beat.character_id);
    const worn = effectiveLayers(member, beat);
    return {
      beat: beat.index,
      seconds: (beat.duration_ms / 1000).toFixed(2),
      actor: member?.actor ?? `?${beat.character_id}`,
      role: member?.display_name ?? beat.character_id,
      text: beat.text,
      expression: beat.expression,
      sfx: beat.sfx.map((s) => `${s.audio}@${(s.at_ms / 1000).toFixed(1)}s`).join("; "),
      // Resolved per beat: a cast-level costume repeats on every beat the role
      // speaks, and a beat's override replaces it here too — the column says
      // what is on screen during this beat, not what was authored where.
      layers: SLOT_ORDER.filter((slot) => worn[slot])
        .map((slot) => `${slot}=${worn[slot]}`)
        .join("; "),
    };
  });
}

const cell = (r: Row, k: (typeof COLUMNS)[number]) => String(r[k]);

// A cue like sfx_whoosh@0.4s looks like an email address to GitHub's
// Markdown, which turns it into a mailto: link. Code spans stop that.
const codeCues = (sfx: string) =>
  sfx === ""
    ? ""
    : sfx
        .split("; ")
        .map((cue) => `\`${cue}\``)
        .join("; ");

export function toMarkdown(rows: Row[]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const header = `| ${COLUMNS.join(" | ")} |`;
  const rule = `| ${COLUMNS.map(() => "---").join(" | ")} |`;
  const md = (r: Row, c: (typeof COLUMNS)[number]) => (c === "sfx" ? codeCues(r.sfx) : esc(cell(r, c)));
  const body = rows.map((r) => `| ${COLUMNS.map((c) => md(r, c)).join(" | ")} |`);
  return [header, rule, ...body].join("\n");
}

export function toCsv(rows: Row[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = COLUMNS.join(",");
  const body = rows.map((r) => COLUMNS.map((c) => esc(cell(r, c))).join(","));
  return [header, ...body].join("\n");
}

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: "usage: npm run export:story -- --bundle <dir> [--csv]",
    options: {
      bundle: { type: "string", required: true },
      csv: { type: "boolean" },
    },
  });
  const rows = buildRows(loadBundle(values.bundle).perf);
  console.log(values.csv ? toCsv(rows) : toMarkdown(rows));
}

runCli(import.meta.url, main);
