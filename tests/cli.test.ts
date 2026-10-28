import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HelpRequested,
  PORT,
  ROOT,
  UsageError,
  parseCli,
  runCli,
  runMain,
  type CliOption,
  type CliSpec,
  type Main,
} from "../tools/lib/cli";

const USAGE = "usage: npm run tool -- --bundle <dir> [--csv]";

const SPEC = {
  usage: USAGE,
  options: {
    bundle: { type: "string", required: true },
    csv: { type: "boolean" },
  },
} as const;

/** The UsageError parseCli throws for `argv`. Fails the test if it throws anything else, or nothing. */
function rejection<O extends Record<string, CliOption>>(argv: string[], spec: CliSpec<O>): UsageError {
  try {
    parseCli(argv, spec);
  } catch (err) {
    if (err instanceof UsageError) return err;
    throw err;
  }
  throw new Error(`parseCli accepted ${JSON.stringify(argv)}`);
}

describe("parseCli: options", () => {
  it("reads a string option and a boolean flag", () => {
    expect(parseCli(["--bundle", "fixtures/x", "--csv"], SPEC).values).toEqual({
      bundle: "fixtures/x",
      csv: true,
    });
  });

  it("reads --name=value", () => {
    expect(parseCli(["--bundle=fixtures/x"], SPEC).values.bundle).toBe("fixtures/x");
  });

  it("reports an absent flag as false and an absent string as undefined", () => {
    const spec = { usage: USAGE, options: { out: { type: "string" }, csv: { type: "boolean" } } } as const;
    expect(parseCli([], spec).values).toEqual({ out: undefined, csv: false });
  });

  it("applies a default when the option is absent", () => {
    const spec = { usage: USAGE, options: { troupe: { type: "string", default: "troupe.json" } } } as const;
    expect(parseCli([], spec).values.troupe).toBe("troupe.json");
    expect(parseCli(["--troupe", "other.json"], spec).values.troupe).toBe("other.json");
  });

  it("collects a repeatable option in order, and gives [] when it is absent", () => {
    const spec = { usage: USAGE, options: { bundle: { type: "string", multiple: true } } } as const;
    expect(parseCli(["--bundle", "a", "--bundle", "b"], spec).values.bundle).toEqual(["a", "b"]);
    expect(parseCli([], spec).values.bundle).toEqual([]);
  });

  it("requires a required repeatable option at least once", () => {
    const spec = {
      usage: USAGE,
      options: { bundle: { type: "string", multiple: true, required: true } },
    } as const;
    expect(rejection([], spec).message).toBe("--bundle is required");
  });
});

describe("parseCli: usage errors", () => {
  it("rejects an unknown option, naming it, and carries the usage", () => {
    const err = rejection(["--bundle", "x", "--bundel", "y"], SPEC);
    expect(err.message).toBe("unknown option --bundel");
    expect(err.usage).toBe(USAGE);
  });

  it("rejects an unknown short option", () => {
    expect(rejection(["--bundle", "x", "-x"], SPEC).message).toBe("unknown option -x");
  });

  it("rejects an option with no value at the end of the line", () => {
    expect(rejection(["--bundle"], SPEC).message).toBe("--bundle needs a value");
  });

  it("never takes the next flag as a value", () => {
    expect(rejection(["--bundle", "--csv"], SPEC).message).toBe("--bundle needs a value");
  });

  it("rejects an empty value", () => {
    expect(rejection(["--bundle="], SPEC).message).toBe("--bundle needs a value");
  });

  it("rejects a value given to a flag", () => {
    expect(rejection(["--bundle", "x", "--csv=yes"], SPEC).message).toBe("--csv takes no value");
  });

  it("rejects a missing required option", () => {
    expect(rejection(["--csv"], SPEC).message).toBe("--bundle is required");
  });

  it("rejects a positional argument when the tool takes none", () => {
    expect(rejection(["--bundle", "x", "stray"], SPEC).message).toBe('unexpected argument "stray"');
  });

  it("gives a removed flag its own message, with or without a value", () => {
    const spec = { ...SPEC, removed: { target: "--target was removed: every app builds for the device" } };
    expect(rejection(["--target"], spec).message).toBe(
      "--target was removed: every app builds for the device",
    );
    expect(rejection(["--target", "device"], spec).message).toBe(
      "--target was removed: every app builds for the device",
    );
  });
});

describe("parseCli: positionals", () => {
  const spec = { usage: USAGE, options: { out: { type: "string" } }, positionals: ["<actor-id>"] } as const;

  it("returns the named positionals, wherever they sit among the options", () => {
    expect(parseCli(["milo", "--out", "x.png"], spec).positionals).toEqual(["milo"]);
    expect(parseCli(["--out", "x.png", "milo"], spec).positionals).toEqual(["milo"]);
  });

  it("names a missing positional", () => {
    expect(rejection(["--out", "x.png"], spec).message).toBe("missing <actor-id>");
  });

  it("rejects one too many", () => {
    expect(rejection(["milo", "tuk"], spec).message).toBe('unexpected argument "tuk"');
  });

  it("treats everything after -- as positional", () => {
    expect(parseCli(["--", "--out"], spec).positionals).toEqual(["--out"]);
  });
});

describe("parseCli: numbers and choices", () => {
  const spec = {
    usage: USAGE,
    options: {
      port: PORT,
      "max-ms": { type: "number" },
      timeout: { type: "number", min: 0, default: 600 },
      clock: { type: "string", choices: ["real", "virtual"] },
    },
  } as const;

  it("reads numbers, and applies a number's default", () => {
    const { values } = parseCli(["--port", "8787", "--max-ms", "2500.5"], spec);
    expect(values).toMatchObject({ port: 8787, "max-ms": 2500.5, timeout: 600 });
  });

  it("leaves an absent number without a default undefined", () => {
    expect(parseCli([], spec).values.port).toBeUndefined();
  });

  it("rejects a value that is not a number", () => {
    expect(rejection(["--max-ms", "soon"], spec).message).toBe('--max-ms must be a number, got "soon"');
    expect(rejection(["--max-ms", "Infinity"], spec).message).toBe(
      '--max-ms must be a number, got "Infinity"',
    );
    expect(rejection(["--max-ms= "], spec).message).toBe('--max-ms must be a number, got " "');
  });

  it("accepts every port from 0 to 65535 and nothing else", () => {
    expect(parseCli(["--port", "0"], spec).values.port).toBe(0);
    expect(parseCli(["--port", "65535"], spec).values.port).toBe(65535);
    for (const bad of ["abc", "65536", "-1", "80.5", "8787abc"]) {
      expect(rejection([`--port=${bad}`], spec).message).toBe(
        `--port must be an integer from 0 to 65535, got "${bad}"`,
      );
    }
  });

  it("rejects a number under its minimum", () => {
    expect(rejection(["--timeout=-5"], spec).message).toBe(
      '--timeout must be a number of at least 0, got "-5"',
    );
  });

  it("accepts only a listed choice", () => {
    expect(parseCli(["--clock", "virtual"], spec).values.clock).toBe("virtual");
    expect(rejection(["--clock", "fast"], spec).message).toBe(
      '--clock must be one of real, virtual, got "fast"',
    );
  });
});

describe("parseCli: --help", () => {
  for (const flag of ["--help", "-h"]) {
    it(`throws HelpRequested with the usage for ${flag}, even on a line that is otherwise wrong`, () => {
      for (const argv of [[flag], ["--bundel", flag], [flag, "--bundle"]]) {
        expect(() => parseCli(argv, SPEC)).toThrow(HelpRequested);
        try {
          parseCli(argv, SPEC);
        } catch (err) {
          expect((err as HelpRequested).usage).toBe(USAGE);
        }
      }
    });
  }

  it("reads --help after -- as a positional", () => {
    const spec = { usage: USAGE, positionals: ["<file>"] };
    expect(parseCli(["--", "--help"], spec).positionals).toEqual(["--help"]);
  });
});

describe("runMain: exit codes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Run `main` and collect what it printed, as runCli would show it. */
  async function run(main: Main, argv: string[] = []) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runMain(main, argv, {
      log: (line: string) => stdout.push(line),
      error: (line: string) => stderr.push(line),
    });
    return { code, stdout, stderr };
  }

  it("exits 0 when main returns, and prints nothing of its own", async () => {
    vi.stubEnv("DEBUG", "");
    expect(await run(() => undefined)).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(await run(async () => undefined)).toEqual({ code: 0, stdout: [], stderr: [] });
  });

  it("passes argv to main", async () => {
    const main = vi.fn();
    await run(main, ["--bundle", "x"]);
    expect(main).toHaveBeenCalledWith(["--bundle", "x"]);
  });

  it("exits with the code main returns after reporting a failure itself", async () => {
    expect((await run(() => 1)).code).toBe(1);
    expect((await run(async () => 1)).code).toBe(1);
  });

  it("prints the usage to stdout and exits 0 for --help", async () => {
    const main = (argv: string[]) => {
      parseCli(argv, SPEC);
    };
    expect(await run(main, ["--help"])).toEqual({ code: 0, stdout: [USAGE], stderr: [] });
  });

  it("prints a usage error and the usage to stderr and exits 2, thrown or rejected", async () => {
    const expected = { code: 2, stdout: [], stderr: ["error: unknown option --bundel", USAGE] };
    const main = (argv: string[]) => {
      parseCli(argv, SPEC);
    };
    expect(await run(main, ["--bundel", "x"])).toEqual(expected);
    expect(await run(async (argv) => main(argv), ["--bundel", "x"])).toEqual(expected);
  });

  it("prints only the message of a usage error that carries no usage", async () => {
    const main = () => {
      throw new UsageError("--entry viewer takes no --bundle");
    };
    expect(await run(main)).toEqual({
      code: 2,
      stdout: [],
      stderr: ["error: --entry viewer takes no --bundle"],
    });
  });

  it("prints any other error as one line with no stack trace and exits 1", async () => {
    vi.stubEnv("DEBUG", "");
    const main = async () => {
      throw new Error('no performance.json under "x"');
    };
    expect(await run(main)).toEqual({
      code: 1,
      stdout: [],
      stderr: ['error: no performance.json under "x"'],
    });
  });

  it("prints a thrown non-Error as a string", async () => {
    vi.stubEnv("DEBUG", "");
    const main = () => {
      throw "plain string";
    };
    expect(await run(main)).toEqual({ code: 1, stdout: [], stderr: ["error: plain string"] });
  });

  it("adds the stack trace when DEBUG is set", async () => {
    vi.stubEnv("DEBUG", "1");
    const err = new Error("boom");
    const { code, stderr } = await run(() => {
      throw err;
    });
    expect(code).toBe(1);
    expect(stderr).toEqual(["error: boom", err.stack]);
  });
});

describe("runCli", () => {
  it("does nothing when the module is imported rather than run", () => {
    const main = vi.fn();
    runCli(import.meta.url, main);
    expect(main).not.toHaveBeenCalled();
  });

  // The one test that runs a real process: it proves the entry check passes
  // for a script run by tsx and that the exit code reaches the shell.
  it("runs main in a script and sets the exit code", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "tests/helpers/cli-fixture.ts", "--bogus"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, DEBUG: "" },
    });
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("error: unknown option --bogus\nusage: cli-fixture [--say <text>]\n");
    expect(r.status).toBe(2);
  });
});

describe("ROOT", () => {
  it("is the repository root, as an absolute path with no trailing separator", () => {
    expect(ROOT).toBe(path.resolve(fileURLToPath(import.meta.url), "../.."));
    expect(path.isAbsolute(ROOT)).toBe(true);
    expect(ROOT.endsWith(path.sep)).toBe(false);
    expect(existsSync(path.join(ROOT, "package.json"))).toBe(true);
  });
});
