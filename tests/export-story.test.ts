import { describe, it, expect } from "vitest";
import { loadBundle } from "../tools/lib/bundle";
import { buildRows, toMarkdown, toCsv, COLUMNS } from "../tools/export-story";
import type { Performance } from "../tools/lib/types";

const bundle = loadBundle("fixtures/knight-and-lonely-dragon");
const rows = buildRows(bundle.perf);

describe("buildRows", () => {
  it("emits one row per beat, in timeline order", () => {
    expect(rows).toHaveLength(bundle.perf.timeline.length);
    expect(rows.map((r) => r.beat)).toEqual(bundle.perf.timeline.map((b) => b.index));
  });

  it("resolves character_id to its cast actor and display name (role)", () => {
    const dragon = rows.find((r) => r.role === "the dragon")!;
    expect(dragon.actor).toBe("tuk"); // the fixed troupe body
    expect(dragon.role).toBe("the dragon"); // the in-story character
  });

  it("formats duration as fixed 2dp seconds", () => {
    const beat0 = bundle.perf.timeline[0];
    expect(rows[0].seconds).toBe((beat0.duration_ms / 1000).toFixed(2));
  });

  it("renders sfx cues as id@Xs, joined, and empty when there are none", () => {
    expect(rows[1].sfx).toBe("sfx_whoosh@0.4s"); // beat 1 has a whoosh at 400ms
    expect(rows[0].sfx).toBe(""); // beat 0 has none
  });

  it("names the layers a role wears, and stays empty when it wears nothing", () => {
    expect(rows.find((r) => r.role === "the dragon")!.layers).toBe("headwear=horns");
    expect(rows.find((r) => r.role === "Miss Moon")!.layers).toBe("");
  });

  it("lists layers back to front and skips empty slots", () => {
    const dressed: Performance = {
      ...bundle.perf,
      cast: bundle.perf.cast.map((c) =>
        c.character_id === "dragon"
          ? { ...c, layers: { headwear: "horns", back_prop: "wings", costume: null } }
          : c,
      ),
      timeline: [bundle.perf.timeline.find((b) => b.character_id === "dragon")!],
    };
    expect(buildRows(dressed)[0].layers).toBe("back_prop=wings; headwear=horns");
  });

  it("flags an unknown character_id instead of throwing", () => {
    const orphan: Performance = {
      ...bundle.perf,
      timeline: [{ ...bundle.perf.timeline[0], character_id: "ghost" }],
    };
    const r = buildRows(orphan)[0];
    expect(r.actor).toBe("?ghost");
    expect(r.role).toBe("ghost");
  });
});

describe("toMarkdown", () => {
  it("has a header, a rule row, and one row per beat", () => {
    const lines = toMarkdown(rows).split("\n");
    expect(lines[0]).toBe(`| ${COLUMNS.join(" | ")} |`);
    expect(lines[1]).toBe(`| ${COLUMNS.map(() => "---").join(" | ")} |`);
    expect(lines).toHaveLength(2 + rows.length);
  });

  it("escapes pipes so table text never breaks the columns", () => {
    const md = toMarkdown([{ ...rows[0], text: "a | b" }]);
    expect(md).toContain("a \\| b");
  });

  // GitHub autolinks sfx_whoosh@0.4s as an email address; a code span does not.
  it("puts each sfx cue in a code span, and leaves an empty cell empty", () => {
    const md = toMarkdown([{ ...rows[1], sfx: "sfx_roar@0.0s; sfx_chime@0.6s" }, rows[0]]).split("\n");
    expect(md[2]).toContain("| `sfx_roar@0.0s`; `sfx_chime@0.6s` |");
    expect(md[3]).not.toContain("`");
  });
});

describe("toCsv", () => {
  it("has a header plus one line per beat", () => {
    const lines = toCsv(rows).split("\n");
    expect(lines[0]).toBe(COLUMNS.join(","));
    expect(lines).toHaveLength(1 + rows.length);
  });

  it("quotes fields containing commas or quotes (RFC 4180)", () => {
    const csv = toCsv([{ ...rows[0], text: 'hi, "there"' }]);
    expect(csv).toContain('"hi, ""there"""');
  });
});
