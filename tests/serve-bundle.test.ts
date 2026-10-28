import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createNetServer } from "node:net";
import { buildManifest, createBundleServer, pickLanHost } from "../tools/serve-bundle";
import { loadBundle } from "../tools/lib/bundle";
import { stagedAudioFiles } from "../tools/lib/staging";

const KNIGHT = "fixtures/knight-and-lonely-dragon";

describe("buildManifest", () => {
  it("covers exactly the staged file set with real sizes and 8-hex crcs", () => {
    const manifest = buildManifest(KNIGHT);
    expect(manifest.bundle).toBe("knight-and-lonely-dragon");
    const staged = stagedAudioFiles(loadBundle(KNIGHT));
    expect(manifest.files.map((f) => f.path)).toEqual(staged.map((s) => s.base));
    for (const [i, f] of manifest.files.entries()) {
      expect(f.size).toBe(statSync(staged[i].src).size);
      expect(f.crc32).toMatch(/^[0-9a-f]{8}$/);
      expect(f.path.endsWith(".wav")).toBe(true);
    }
  });

  it("refuses a bundle whose audio is missing on disk", () => {
    // Same broken-bundle pattern as tests/pack-audio.test.ts: copy the knight
    // bundle to a temp dir and delete one referenced WAV.
    const bundleDir = mkdtempSync(path.join(tmpdir(), "manifest-bundle-"));
    cpSync(KNIGHT, bundleDir, { recursive: true });
    rmSync(path.join(bundleDir, "audio/aud_000.wav"));
    expect(() => buildManifest(bundleDir)).toThrow(/failed validation:[\s\S]*not found under/);
  });
});

describe("createBundleServer", () => {
  async function withServer(
    fn: (srv: Awaited<ReturnType<typeof createBundleServer>>, logs: string[]) => Promise<void>,
  ) {
    const logs: string[] = [];
    const srv = await createBundleServer(KNIGHT, { host: "127.0.0.1", log: (l) => logs.push(l) });
    try {
      await fn(srv, logs);
    } finally {
      await srv.close();
    }
  }

  it("serves a manifest file with correct bytes and logs the request", () =>
    withServer(async (srv, logs) => {
      const manifest = buildManifest(KNIGHT);
      const first = manifest.files[0];
      const res = await fetch(`${srv.baseUrl}${first.path}`);
      expect(res.status).toBe(200);
      const body = new Uint8Array(await res.arrayBuffer());
      expect(body.length).toBe(first.size);
      const entry = JSON.parse(logs.at(-1)!);
      expect(entry).toMatchObject({
        path: `/knight-and-lonely-dragon/${first.path}`,
        status: 200,
        bytes: first.size,
      });
      expect(entry.remote).toBeTruthy();
    }));

  it("404s anything outside the manifest", () =>
    withServer(async (srv, logs) => {
      const res = await fetch(`${srv.baseUrl}../performance.json`);
      expect(res.status).toBe(404);
      expect(JSON.parse(logs.at(-1)!).status).toBe(404);
    }));

  it("404s a file that exists on disk in the bundle dir but isn't in the audio allowlist", () =>
    withServer(async (srv, logs) => {
      // Guards against path.join(bundleDir, urlPath)-style serving:
      // performance.json genuinely exists on disk under KNIGHT, but
      // it's not staged audio, so the allowlist must still refuse it.
      expect(statSync(path.join(KNIGHT, "performance.json")).isFile()).toBe(true);
      const res = await fetch(`${srv.baseUrl}performance.json`);
      expect(res.status).toBe(404);
      expect(JSON.parse(logs.at(-1)!).status).toBe(404);
    }));

  it("answers the .already sentinel with 204 and logs it", () =>
    withServer(async (srv, logs) => {
      const res = await fetch(`${srv.baseUrl}.already`);
      expect(res.status).toBe(204);
      expect(JSON.parse(logs.at(-1)!)).toMatchObject({ status: 204, bytes: 0 });
    }));

  it("rejects non-GET methods with 405", () =>
    withServer(async (srv) => {
      const manifest = buildManifest(KNIGHT);
      const res = await fetch(`${srv.baseUrl}${manifest.files[0].path}`, { method: "POST" });
      expect(res.status).toBe(405);
    }));

  it("baseUrl uses the requested host and ends with /<bundle>/", () =>
    withServer(async (srv) => {
      expect(srv.baseUrl).toBe(`http://127.0.0.1:${srv.port}/knight-and-lonely-dragon/`);
    }));
});

describe("createBundleServer binding", () => {
  it("rejects with a clear message when the requested port is taken", async () => {
    const blocker = createNetServer();
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, () => resolve((blocker.address() as { port: number }).port));
    });
    try {
      await expect(createBundleServer(KNIGHT, { port, host: "127.0.0.1", log: () => {} })).rejects.toThrow(
        /could not bind port \d+/,
      );
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

// The device fetches only from a private IPv4 address (StorySyncCore.h), so
// the printed base_url must use one when the Mac has one.
describe("pickLanHost", () => {
  const v4 = (address: string, internal = false) => ({ family: "IPv4", address, internal });

  it("prefers a private address over a VPN or public one listed first", () => {
    expect(pickLanHost({ utun4: [v4("100.101.102.103")], en0: [v4("192.168.1.42")] })).toBe("192.168.1.42");
    expect(pickLanHost({ eth0: [v4("8.8.4.4")], en1: [v4("10.0.0.7")] })).toBe("10.0.0.7");
    expect(pickLanHost({ en0: [v4("172.20.10.13")] })).toBe("172.20.10.13");
  });

  it("falls back to the first external address, then to loopback", () => {
    expect(pickLanHost({ lo0: [v4("127.0.0.1", true)], utun4: [v4("100.64.0.9")] })).toBe("100.64.0.9");
    expect(pickLanHost({ lo0: [v4("127.0.0.1", true)] })).toBe("127.0.0.1");
    expect(pickLanHost({ en0: [{ family: "IPv6", address: "fe80::1", internal: false }] })).toBe("127.0.0.1");
  });
});
