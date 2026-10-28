// A tool reduced to its command line, for the test in tests/cli.test.ts that
// runs runCli in a real process.
import { parseCli, runCli } from "../../tools/lib/cli";

export function main(argv: string[]): void {
  const { values } = parseCli(argv, {
    usage: "usage: cli-fixture [--say <text>]",
    options: { say: { type: "string" } },
  });
  if (values.say) console.log(values.say);
}

runCli(import.meta.url, main);
