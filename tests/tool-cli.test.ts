// Every tool in tools/ shares one command line (tools/lib/cli.ts). Each one
// exports main(argv), importing it runs nothing, and a bad invocation is a
// UsageError before the tool touches anything.
import { readdirSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { HelpRequested, UsageError, type Main } from "../tools/lib/cli";

interface Tool {
  name: string;
  load: () => Promise<{ main: Main }>;
  /** Takes --bundle <dir>. */
  bundle: boolean;
}

const TOOLS: Tool[] = [
  { name: "build-app", load: () => import("../tools/build-app"), bundle: true },
  { name: "export-story", load: () => import("../tools/export-story"), bundle: true },
  { name: "export-video", load: () => import("../tools/export-video"), bundle: true },
  { name: "gen-all-audio", load: () => import("../tools/gen-all-audio"), bundle: false },
  { name: "gen-gfx-font", load: () => import("../tools/gen-gfx-font"), bundle: false },
  { name: "gen-invalid-fixtures", load: () => import("../tools/gen-invalid-fixtures"), bundle: false },
  { name: "gen-line-audio", load: () => import("../tools/gen-line-audio"), bundle: true },
  { name: "gen-sfx", load: () => import("../tools/gen-sfx"), bundle: true },
  { name: "gen-social-preview", load: () => import("../tools/gen-social-preview"), bundle: false },
  { name: "gen-troupe-header", load: () => import("../tools/gen-troupe-header"), bundle: false },
  { name: "pack-audio", load: () => import("../tools/pack-audio"), bundle: true },
  { name: "preview-art", load: () => import("../tools/preview-art"), bundle: false },
  { name: "preview-audio", load: () => import("../tools/preview-audio"), bundle: true },
  { name: "preview-layout", load: () => import("../tools/preview-layout"), bundle: false },
  { name: "serve-bundle", load: () => import("../tools/serve-bundle"), bundle: true },
  { name: "sim", load: () => import("../tools/sim"), bundle: true },
  { name: "validate", load: () => import("../tools/validate"), bundle: false },
];

/** Modules in tools/ that other tools import, with no command line of their own. */
const LIBRARIES = ["gen-performance-data", "gen-sprite-data"];

/** Per tool: its module, or the error importing it threw, and what the import printed or tried. */
const imported = new Map<string, { main?: Main; error?: unknown; effects: string[] }>();

// Every tool is imported here, once, with output and process.exit watched: a
// module that does work at import time shows up as an effect or an error.
beforeAll(async () => {
  let current = "";
  const effects = new Map<string, string[]>();
  const record =
    (what: string) =>
    (...args: unknown[]) => {
      effects.get(current)!.push(`${what}: ${args.map(String).join(" ")}`);
    };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(record("console.log")),
    vi.spyOn(console, "info").mockImplementation(record("console.info")),
    vi.spyOn(console, "warn").mockImplementation(record("console.warn")),
    vi.spyOn(console, "error").mockImplementation(record("console.error")),
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) at import`);
    }) as never),
  ];
  try {
    for (const tool of TOOLS) {
      current = tool.name;
      effects.set(current, []);
      try {
        const { main } = await tool.load();
        imported.set(tool.name, { main, effects: effects.get(current)! });
      } catch (error) {
        imported.set(tool.name, { error, effects: effects.get(current)! });
      }
    }
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

/** What `tool`'s main throws or rejects with for `argv`. Fails the test if main accepts it. */
async function rejection(tool: Tool, argv: string[]): Promise<unknown> {
  const { main } = imported.get(tool.name)!;
  try {
    await main!(argv);
  } catch (err) {
    return err;
  }
  throw new Error(`${tool.name} accepted ${JSON.stringify(argv)}`);
}

it("covers every module in tools/", () => {
  const onDisk = readdirSync("tools")
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
  expect([...TOOLS.map((t) => t.name), ...LIBRARIES].sort()).toEqual(onDisk);
});

for (const tool of TOOLS) {
  describe(`tools/${tool.name}.ts`, () => {
    it("imports without running, and exports main", () => {
      const { main, error, effects } = imported.get(tool.name)!;
      expect(error).toBeUndefined();
      expect(effects).toEqual([]);
      expect(main).toBeTypeOf("function");
    });

    it("rejects an unknown flag as a usage error", async () => {
      const err = await rejection(tool, ["--no-such-flag"]);
      expect(err).toBeInstanceOf(UsageError);
      expect((err as UsageError).message).toBe("unknown option --no-such-flag");
      expect((err as UsageError).usage).toMatch(/^usage: /);
    });

    it("answers --help with its usage", async () => {
      const err = await rejection(tool, ["--help"]);
      expect(err).toBeInstanceOf(HelpRequested);
      expect((err as HelpRequested).usage).toMatch(/^usage: /);
    });

    if (tool.bundle) {
      it("rejects --bundle with no value as a usage error", async () => {
        const err = await rejection(tool, ["--bundle"]);
        expect(err).toBeInstanceOf(UsageError);
        expect((err as UsageError).message).toBe("--bundle needs a value");
      });
    }
  });
}

// gen-line-audio renders with macOS `say`, which a test cannot run. Its
// argument handling runs before the first `say`, so it is covered here.
describe("gen-line-audio's arguments", () => {
  const genLineAudio = TOOLS.find((t) => t.name === "gen-line-audio")!;

  it("requires --bundle", async () => {
    const err = await rejection(genLineAudio, ["--write-durations"]);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).message).toBe("--bundle is required");
  });

  it("rejects a bundle given as a positional", async () => {
    const err = await rejection(genLineAudio, ["fixtures/knight-and-lonely-dragon"]);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).message).toBe('unexpected argument "fixtures/knight-and-lonely-dragon"');
  });

  it("passes a valid line on to the bundle, which is read before any rendering", async () => {
    const err = await rejection(genLineAudio, ["--bundle", "fixtures/no-such-story", "--write-durations"]);
    expect(err).not.toBeInstanceOf(UsageError);
    expect((err as Error).message).toMatch(/no performance\.json under "fixtures\/no-such-story"/);
  });
});
