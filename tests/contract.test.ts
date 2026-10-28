import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { loadTroupe } from "../tools/lib/troupe";

describe("performance.schema.json", () => {
  it("compiles under ajv", () => {
    const schema = JSON.parse(readFileSync("schema/performance.schema.json", "utf8"));
    const ajv = new Ajv({ allErrors: true });
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe("troupe.schema.json", () => {
  it("compiles under ajv", () => {
    const schema = JSON.parse(readFileSync("schema/troupe.schema.json", "utf8"));
    const ajv = new Ajv({ allErrors: true });
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe("troupe.json", () => {
  const troupe = loadTroupe();

  it("loads through the schema-checked loader", () => {
    expect(() => loadTroupe()).not.toThrow();
  });

  it("has the six actors and Miss Moon", () => {
    expect(troupe.actors.map((a) => a.id).sort()).toEqual(["ada", "bruno", "milo", "pip", "rosa", "tuk"]);
    expect(troupe.mc.id).toBe("miss_moon");
  });

  it("base expression set is the locked six", () => {
    expect(troupe.expressions.base).toEqual(["neutral", "happy", "sad", "surprised", "angry", "scared"]);
  });

  it("miss_moon expression set is the locked seven", () => {
    expect(troupe.expressions.miss_moon).toEqual([
      "neutral",
      "happy",
      "delighted",
      "giggling",
      "curious",
      "surprised",
      "sad",
    ]);
  });

  it("every vocabulary sound uses the sfx_ asset-id namespace", () => {
    for (const id of troupe.sfx_vocabulary) expect(id).toMatch(/^sfx_[a-z_]+$/);
  });
});
