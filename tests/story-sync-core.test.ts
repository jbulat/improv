// The firmware's announce rules (device/lib/drivers/src/StorySyncCore.h),
// compiled on the host and run against the case table in
// tests/story-sync-cases.json.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HARNESS_SRC = "tests/helpers/story-sync-harness.cpp";

type Case<T> = [T, boolean];
const CASES = JSON.parse(readFileSync("tests/story-sync-cases.json", "utf8")) as {
  bundle: Case<string>[];
  file: Case<string>[];
  crc: Case<string>[];
  size: Case<number>[];
  baseUrl: Case<string>[];
};

let workDir: string;
let bin: string;

/** Runs harness commands, one per line, and returns one output line each. */
function harness(commands: string[]): string[] {
  const out = execFileSync(bin, { input: commands.join("\n") + "\n", encoding: "utf8" });
  return out.trimEnd().split("\n");
}

/** One harness argument: percent-encoded, so a test can send any byte, and "-" when empty. */
const enc = (s: string | number) => {
  if (s === "") return "-";
  let out = "";
  for (const c of String(s)) {
    const code = c.charCodeAt(0);
    out += code <= 0x20 || code === 0x7f || c === "%" ? `%${code.toString(16).padStart(2, "0")}` : c;
  }
  return out;
};

/** One harness command and its one-line answer. */
const ask = (cmd: string, ...args: (string | number)[]) => harness([[cmd, ...args.map(enc)].join(" ")])[0];

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "story-sync-core-"));
  bin = path.join(workDir, "story-sync-harness");
  execFileSync(process.env.CXX ?? "c++", ["-std=c++17", "-O1", "-o", bin, HARNESS_SRC]);
}, 120_000);

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const tables = [
  { name: "bundle names", cmd: "bundle", cases: CASES.bundle },
  { name: "file names", cmd: "file", cases: CASES.file },
  { name: "crc32 hex", cmd: "crc", cases: CASES.crc },
  { name: "file sizes", cmd: "size", cases: CASES.size },
  { name: "base URLs", cmd: "baseurl", cases: CASES.baseUrl },
] as const;

describe("announce rules: the firmware agrees with the case table", () => {
  for (const t of tables) {
    it(t.name, () => {
      const got = harness(t.cases.map(([input]) => `${t.cmd} ${enc(input)}`));
      const want = t.cases.map(([, ok]) => (ok ? "1" : "0"));
      expect(got).toEqual(want);
    });
  }
});

// The request the device sends for each file. With no keep-alive, every file
// is one connection, so a socket left open to an earlier server is never reused.
describe("the GET request", () => {
  it("parses a base URL into an address, a port and a path ending in '/'", () => {
    expect(ask("parseurl", "http://192.168.1.20:8787/knight")).toBe("192.168.1.20 8787 /knight/");
    expect(ask("parseurl", "http://10.0.0.5")).toBe("10.0.0.5 80 /");
    expect(ask("parseurl", "http://example.com/")).toBe("0");
  });

  it("asks for base path + file name over HTTP/1.0, then closes", () => {
    const want = "GET /knight/aud_000.wav HTTP/1.0\r\nHost: 192.168.1.20:8787\r\nConnection: close\r\n\r\n";
    expect(decodeURIComponent(ask("request", "http://192.168.1.20:8787/knight/", "aud_000.wav"))).toBe(want);
  });
});

// The response header is read by the device's own loop, a few bytes per tick,
// so a hostile server cannot hold the loop. These are the rules for when the
// header is complete, and when to give up on it.
describe("the response header", () => {
  const head = (text: string) => ask("head", text);

  it("ends at the first empty line, with CRLF or bare LF", () => {
    expect(head("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n")).toBe("done 200");
    expect(head("HTTP/1.0 404 Not Found\r\n\r\n")).toBe("done 404");
    expect(head("HTTP/1.1 200 OK\n\n")).toBe("done 200");
    expect(head("HTTP/1.1 200\r\n\r\n")).toBe("done 200");
  });

  it("waits for more while the header is incomplete", () => {
    expect(head("HTTP/1.1 200 OK\r\nX: y\r\n")).toBe("more");
    expect(head("HTTP/1.1 2")).toBe("more");
  });

  it("refuses a status line that is not HTTP/1.x and a three-digit code", () => {
    expect(head("FTP 200 OK\r\n\r\n")).toBe("error bad status line");
    expect(head("HTTP/1.1 2x0 OK\r\n\r\n")).toBe("error bad status line");
    expect(head("HTTP/2 200\r\n\r\n")).toBe("error bad status line");
  });

  it("gives up on a header longer than 2 KB: one long line or many short ones", () => {
    expect(head("HTTP/1.1 200 OK\r\nX: " + "a".repeat(3000))).toBe("error header too long");
    expect(head("HTTP/1.1 200 OK\r\n" + "X: y\r\n".repeat(400))).toBe("error header too long");
  });
});

describe("the per-file deadline", () => {
  it("allows 10 s for the header plus 1 s for every 4 KB of the file", () => {
    expect(ask("deadline", 0)).toBe("10000");
    expect(ask("deadline", 4096)).toBe("11000");
    expect(ask("deadline", 1_000_000)).toBe("254140");
  });

  it("does not overflow for the largest size an announce allows", () => {
    expect(ask("deadline", 0xffffffff)).toBe("1048585999");
  });
});

// Eviction is planned before anything is deleted, so an announce that can
// never fit fails with every other story still on disk.
describe("the eviction plan", () => {
  const evict = (need: number, free: number, current: string, entries: string) =>
    harness([`evict ${need} ${free} ${current} ${entries}`])[0];

  it("evicts nothing when the story already fits", () => {
    expect(evict(100, 200, "cur", "a:50")).toBe("1");
  });

  it("evicts the oldest stories first, and only as many as it needs", () => {
    expect(evict(40, 0, "cur", "b:50,a:50")).toBe("1 b");
    expect(evict(60, 0, "cur", "b:50,a:50")).toBe("1 b,a");
  });

  it("never evicts the story being fetched", () => {
    expect(evict(100, 10, "cur", "a:50,cur:500,b:50")).toBe("1 a,b");
  });

  it("refuses, evicting nothing, when even every other story would not make room", () => {
    expect(evict(1000, 0, "cur", "a:10,b:10")).toBe("0");
    expect(evict(100, 10, "cur", "cur:500,a:30")).toBe("0");
  });

  it("skips index entries that are not bundle names", () => {
    expect(evict(50, 0, "cur", ":100,Bad_Name:100,a:60")).toBe("1 a");
  });
});
