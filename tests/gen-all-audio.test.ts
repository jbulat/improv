// gen:audio:all renders every bundle through gen-line-audio's main, in this
// process. gen-line-audio needs Kokoro, so it is replaced here, and so is the
// check that Kokoro is installed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../tools/gen-all-audio";
import { main as genLineAudio } from "../tools/gen-line-audio";
import { bundleDirs } from "../tools/lib/bundle";
import { assertKokoroReady } from "../tools/lib/kokoro";

vi.mock("../tools/gen-line-audio", () => ({ main: vi.fn() }));
vi.mock("../tools/lib/kokoro", () => ({ assertKokoroReady: vi.fn() }));

const renderBundle = vi.mocked(genLineAudio);
const kokoroReady = vi.mocked(assertKokoroReady);

let stderr: string[];

beforeEach(() => {
  renderBundle.mockReset();
  kokoroReady.mockReset();
  stderr = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gen:audio:all", () => {
  it("renders every bundle in order, in this process", () => {
    expect(main([])).toBeUndefined();
    expect(renderBundle.mock.calls).toEqual(bundleDirs().map((dir) => [["--bundle", dir]]));
  });

  it("passes --write-durations on to every bundle", () => {
    main(["--write-durations"]);
    expect(renderBundle.mock.calls).toEqual(
      bundleDirs().map((dir) => [["--bundle", dir, "--write-durations"]]),
    );
  });

  it("carries on past a bundle that fails, then names it and exits 1", () => {
    const [first, second] = bundleDirs();
    renderBundle.mockImplementation((argv) => {
      if (argv[1] === first) throw new Error("no Kokoro mapping for voice id");
    });
    expect(main([])).toBe(1);
    expect(renderBundle).toHaveBeenCalledWith(["--bundle", second]);
    expect(renderBundle).toHaveBeenCalledTimes(bundleDirs().length);
    expect(stderr).toContain("error: no Kokoro mapping for voice id");
    expect(stderr.at(-1)).toBe(`\ngen:audio failed for: ${first}`);
  });

  it("refuses to run without Kokoro, before rendering anything", () => {
    kokoroReady.mockImplementation(() => {
      throw new Error("Kokoro is not installed in /nowhere. Run npm run setup:kokoro");
    });
    expect(main([])).toBe(1);
    expect(renderBundle).not.toHaveBeenCalled();
    expect(stderr).toEqual(["error: Kokoro is not installed in /nowhere. Run npm run setup:kokoro"]);
  });
});
