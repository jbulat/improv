// The command line that every tool in tools/ shares. A tool parses its argv
// with parseCli, exports main, and ends with runCli:
//
//   export function main(argv: string[]): void {
//     const { values } = parseCli(argv, {
//       usage: "usage: npm run export:story -- --bundle <dir> [--csv]",
//       options: { bundle: { type: "string", required: true }, csv: { type: "boolean" } },
//     });
//     ...
//   }
//
//   runCli(import.meta.url, main);
//
// Parsing is strict. An unknown flag or a flag without its value is an error,
// never ignored, so a typo cannot quietly change what a tool does: a mistyped
// --check-files must not let an unchecked performance print "valid".
//
// Exit codes: 0 for success and for --help, 1 when the tool fails (main throws,
// or returns 1 after it reports the failure itself), 2 for a usage error.
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

/** The repository root, found from this file, so tools find the repo's files
 *  whatever the current directory is. */
export const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** A bad invocation. runCli prints the message and the usage, and exits 2. */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly usage?: string,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

/** Thrown by parseCli for --help or -h. runCli prints the usage to stdout and exits 0. */
export class HelpRequested extends Error {
  constructor(readonly usage: string) {
    super("help requested");
    this.name = "HelpRequested";
  }
}

interface BooleanOption {
  type: "boolean";
}

interface StringOption {
  type: "string";
  required?: boolean;
  default?: string;
  /** The flag may be given more than once; the value lists each one, in order. */
  multiple?: boolean;
  /** The only values accepted. */
  choices?: readonly string[];
}

interface NumberOption {
  type: "number";
  required?: boolean;
  default?: number;
  integer?: boolean;
  min?: number;
  max?: number;
}

/** One long option, named by its key in CliSpec.options (without the "--"). */
export type CliOption = BooleanOption | StringOption | NumberOption;

/** A TCP port. 0 asks the system for a free one. */
export const PORT = { type: "number", integer: true, min: 0, max: 65535 } as const;

export interface CliSpec<O extends Record<string, CliOption>> {
  /** Printed for --help, and after every usage error. */
  usage: string;
  options?: O;
  /** The positional arguments, all required, named as the usage names them
   *  (e.g. "<actor-id>"). A tool takes none unless it lists them. */
  positionals?: readonly string[];
  /** Flags that no longer exist, each with the message to give in place of
   *  "unknown option", for old notes and shell histories that still use them. */
  removed?: Readonly<Record<string, string>>;
}

type Given<T, V> = T extends { required: true } | { default: unknown } ? V : V | undefined;

type OptionValue<T extends CliOption> = T extends BooleanOption
  ? boolean
  : T extends NumberOption
    ? Given<T, number>
    : T extends { multiple: true }
      ? string[]
      : T extends { choices: readonly (infer C)[] }
        ? Given<T, C>
        : Given<T, string>;

export interface ParsedCli<O extends Record<string, CliOption>> {
  values: { -readonly [K in keyof O]: OptionValue<O[K]> };
  positionals: string[];
}

/**
 * Parse `argv` against `spec`. Throws HelpRequested for --help or -h, and a
 * UsageError for an unknown option, an option without its value, a value
 * given to a flag, a missing required option, a number or choice out of
 * bounds, or the wrong number of positionals.
 */
export function parseCli<const O extends Record<string, CliOption> = Record<never, never>>(
  argv: string[],
  spec: CliSpec<O>,
): ParsedCli<O> {
  const options: Record<string, CliOption> = spec.options ?? {};
  const usageError = (message: string) => new UsageError(message, spec.usage);

  // Help wins over every other problem on the line, so it always answers.
  const end = argv.indexOf("--");
  if ((end === -1 ? argv : argv.slice(0, end)).some((a) => a === "--help" || a === "-h")) {
    throw new HelpRequested(spec.usage);
  }

  // parseArgs splits the line into tokens and values. Its strict checks are
  // made here, over the tokens, so that each message names the flag.
  const config: ParseArgsOptionsConfig = {};
  for (const [name, option] of Object.entries(options)) {
    config[name] =
      option.type === "boolean"
        ? { type: "boolean" }
        : { type: "string", multiple: option.type === "string" && option.multiple === true };
  }
  const parsed = parseArgs({
    args: argv,
    options: config,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    const flag = token.rawName;
    if (spec.removed && Object.hasOwn(spec.removed, token.name)) throw usageError(spec.removed[token.name]);
    const option = Object.hasOwn(options, token.name) ? options[token.name] : undefined;
    if (!option) throw usageError(`unknown option ${flag}`);
    if (option.type === "boolean") {
      if (token.value !== undefined) throw usageError(`${flag} takes no value`);
    } else if (!token.value || (!token.inlineValue && token.value.startsWith("-"))) {
      // A following flag is never taken as the value: "--bundle --csv" lacks one.
      throw usageError(`${flag} needs a value`);
    }
  }

  const names = spec.positionals ?? [];
  const { positionals } = parsed;
  if (positionals.length > names.length)
    throw usageError(`unexpected argument "${positionals[names.length]}"`);
  if (positionals.length < names.length) throw usageError(`missing ${names[positionals.length]}`);

  const values: Record<string, unknown> = {};
  for (const [name, option] of Object.entries(options)) {
    const flag = `--${name}`;
    const raw = parsed.values[name];
    if (option.type === "boolean") {
      values[name] = raw === true;
      continue;
    }
    if (raw === undefined) {
      if (option.required) throw usageError(`${flag} is required`);
      values[name] = option.type === "string" && option.multiple ? [] : option.default;
      continue;
    }
    if (option.type === "number") {
      const n = readNumber(raw as string, option);
      if (n === undefined) throw usageError(`${flag} must be ${describeNumber(option)}, got "${raw}"`);
      values[name] = n;
      continue;
    }
    for (const value of [raw].flat() as string[]) {
      if (option.choices && !option.choices.includes(value)) {
        throw usageError(`${flag} must be one of ${option.choices.join(", ")}, got "${value}"`);
      }
    }
    values[name] = raw;
  }
  return { values, positionals } as ParsedCli<O>;
}

/** `raw` as a number that keeps to `rule`, or undefined when it is not one. */
function readNumber(raw: string, rule: NumberOption): number | undefined {
  const n = Number(raw);
  const ok =
    raw.trim() !== "" &&
    Number.isFinite(n) &&
    (!rule.integer || Number.isInteger(n)) &&
    n >= (rule.min ?? -Infinity) &&
    n <= (rule.max ?? Infinity);
  return ok ? n : undefined;
}

/** "a number", "an integer from 0 to 65535", "a number of at least 0", ... */
function describeNumber({ integer, min, max }: NumberOption): string {
  const kind = integer ? "an integer" : "a number";
  if (min !== undefined && max !== undefined) return `${kind} from ${min} to ${max}`;
  if (min !== undefined) return `${kind} of at least ${min}`;
  if (max !== undefined) return `${kind} of at most ${max}`;
  return kind;
}

/** A tool's entry point. It returns nothing on success, or the exit code of a
 *  failure it has already reported (validate's errors, say). */
export type Main = (argv: string[]) => void | number | Promise<void | number>;

type Output = Pick<Console, "log" | "error">;

/** Print `err` as runCli does: one line, plus the stack trace when DEBUG is set. */
export function reportError(err: unknown, out: Output = console): void {
  out.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  if (process.env.DEBUG && err instanceof Error && err.stack) out.error(err.stack);
}

/** Run `main` with `argv`, report how it ended on `out`, and resolve to the
 *  exit code. Never rejects. */
export async function runMain(main: Main, argv: string[], out: Output = console): Promise<number> {
  try {
    const code = await main(argv);
    return typeof code === "number" ? code : 0;
  } catch (err) {
    if (err instanceof HelpRequested) {
      out.log(err.usage);
      return 0;
    }
    if (err instanceof UsageError) {
      out.error(`error: ${err.message}`);
      if (err.usage) out.error(err.usage);
      return 2;
    }
    reportError(err, out);
    return 1;
  }
}

/**
 * The last line of every tool. When the module is the script node was asked to
 * run, call `main` with the command line's arguments and set the exit code from
 * how it ends. When the module is imported, do nothing.
 *
 * The exit code is set, not forced, so pending output is written before the
 * process ends, and a tool that keeps a server open keeps running.
 */
export function runCli(importMetaUrl: string, main: Main): void {
  if (!isEntryPoint(importMetaUrl)) return;
  void runMain(main, process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

/** Whether `importMetaUrl` is the script node was started with. Both sides are
 *  resolved through symlinks, because node gives the entry module its real path. */
function isEntryPoint(importMetaUrl: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
