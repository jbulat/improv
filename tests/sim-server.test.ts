import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createNetServer } from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { startPanelServer, type PanelServer } from "../tools/lib/sim-server";
import { SCREEN_W, SCREEN_H } from "../tools/lib/sim-raster";
import { encodeWav } from "../tools/lib/wav";

let server: PanelServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function session(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sim-server-"));
  mkdirSync(path.join(dir, "stories", "s"), { recursive: true });
  writeFileSync(path.join(dir, "stories", "s", "a.wav"), encodeWav(new Float32Array(800), 8000));
  return dir;
}

async function start(onButton: (i: number) => void = () => {}): Promise<PanelServer> {
  server = await startPanelServer({
    sessionDir: session(),
    deviceId: "sim-test1234",
    bundleName: "s",
    onButton,
  });
  return server;
}

describe("panel server", () => {
  it("serves the panel page and its assets", async () => {
    const s = await start();
    const page = await fetch(s.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("<canvas");
    expect(html).toContain('id="lcd"');

    const css = await fetch(`${s.url}/panel.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");

    const js = await fetch(`${s.url}/panel.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
  });

  it("serves the latest frame as raw RGB of the right length", async () => {
    const s = await start();
    const rgb = new Uint8Array(SCREEN_W * SCREEN_H * 3).fill(7);
    s.pushFrame(rgb, 1);
    const res = await fetch(`${s.url}/frame/1`);
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(SCREEN_W * SCREEN_H * 3);
    expect(buf[0]).toBe(7);
  });

  it("404s a frame that has been superseded", async () => {
    const s = await start();
    s.pushFrame(new Uint8Array(SCREEN_W * SCREEN_H * 3), 1);
    s.pushFrame(new Uint8Array(SCREEN_W * SCREEN_H * 3), 2);
    expect((await fetch(`${s.url}/frame/1`)).status).toBe(404);
    expect((await fetch(`${s.url}/frame/2`)).status).toBe(200);
  });

  it("serves a session WAV", async () => {
    const s = await start();
    const res = await fetch(`${s.url}/audio/stories/s/a.wav`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/wav");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(44);
  });

  it("refuses an audio path that escapes the session directory", async () => {
    const s = await start();
    // A literal "/audio/../../../etc/passwd" never reaches the server as
    // written: fetch()'s URL parser removes ".." segments client-side (WHATWG
    // dot-segment removal), so the wire request is just "GET /etc/passwd".
    // Percent-encoding the slashes survives that normalization ("%2f" is not
    // a separator to the URL parser) and still decodes to
    // "../../../etc/passwd" server-side, so this exercises the real
    // containment check instead of fetch's own sanitization.
    expect((await fetch(`${s.url}/audio/..%2f..%2f..%2fetc/passwd`)).status).toBe(403);
    expect((await fetch(`${s.url}/audio/%2e%2e%2f%2e%2e%2fetc/passwd`)).status).toBe(403);
  });

  it("404s an unknown route", async () => {
    const s = await start();
    expect((await fetch(`${s.url}/nope`)).status).toBe(404);
  });

  it("forwards button presses and counts them", async () => {
    const pressed: number[] = [];
    const s = await start((i) => pressed.push(i));
    await fetch(`${s.url}/input`, { method: "POST", body: JSON.stringify({ button: 1 }) });
    await fetch(`${s.url}/input`, { method: "POST", body: JSON.stringify({ button: 0 }) });
    expect(pressed).toEqual([1, 0]);
    expect(s.pressCount).toBe(2);
  });

  // This flag is the rail's sim-level freeze control, not the device's own
  // pause (chassis Button 1, which lives entirely inside the Lua app and
  // never touches this server). See the tick loop in tools/sim.ts for what
  // engaging it does.
  it("tracks the freeze flag the core polls", async () => {
    const s = await start();
    expect(s.frozen).toBe(false);
    await fetch(`${s.url}/input`, { method: "POST", body: JSON.stringify({ freeze: true }) });
    expect(s.frozen).toBe(true);
    await fetch(`${s.url}/input`, { method: "POST", body: JSON.stringify({ freeze: false }) });
    expect(s.frozen).toBe(false);
  });

  it("streams frame and sound notifications over SSE", async () => {
    const s = await start();
    const res = await fetch(`${s.url}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    s.pushFrame(new Uint8Array(SCREEN_W * SCREEN_H * 3), 42);
    s.pushSound({ kind: "play", path: "stories/s/a.wav", channel: 0, offsetMs: 0 });

    let text = "";
    while (!text.includes('"kind":"play"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain("event: frame");
    expect(text).toContain('"seq":42');
    expect(text).toContain("event: sound");
    await reader.cancel();
  });
});

describe("panel server binding", () => {
  it("rejects with a clear message when the requested port is taken", async () => {
    const blocker = createNetServer();
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => resolve((blocker.address() as { port: number }).port));
    });
    try {
      await expect(
        startPanelServer({
          sessionDir: session(),
          deviceId: "sim-test1234",
          bundleName: "s",
          onButton: () => {},
          port,
        }),
      ).rejects.toThrow(/could not bind 127\.0\.0\.1:\d+/);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
