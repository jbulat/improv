// The browser panel's server, with no dependencies: SSE carries the
// notifications (frame ready, sound, telemetry, log), the pixels come back over
// a plain GET, and buttons arrive by POST. Frames flow one way, so a WebSocket
// would add a runtime dependency for nothing. Binds to 127.0.0.1 only.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCREEN_W, SCREEN_H } from "./sim-raster";
import { listen } from "./listen";

const PANEL_DIR = fileURLToPath(new URL("../sim-panel/", import.meta.url));

export interface SoundEvent {
  kind: "play" | "stop" | "volume" | "beep" | "tone" | "tone_stop";
  path?: string;
  channel?: number;
  offsetMs?: number;
  volume?: number;
  freq?: number;
  ms?: number;
}

export interface PanelServerOptions {
  port?: number;
  sessionDir: string;
  deviceId: string;
  bundleName: string;
  onButton: (index: number) => void;
}

export interface PanelServer {
  readonly url: string;
  readonly pressCount: number;
  /** True while the sim-level freeze control is engaged. The device's own
   *  pause (chassis Button 1) lives inside the Lua app; this server never
   *  sees it. */
  readonly frozen: boolean;
  pushFrame(rgb: Uint8Array, seq: number): void;
  pushSound(e: SoundEvent): void;
  pushTelemetry(t: unknown): void;
  pushLog(level: string, message: string): void;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wav": "audio/wav",
};

class Panel implements PanelServer {
  private server: Server;
  private clients = new Set<ServerResponse>();
  private frame: Uint8Array | null = null;
  private frameSeq = 0;
  private sessionDir: string;
  private opts: PanelServerOptions;
  url = "";
  pressCount = 0;
  frozen = false;

  constructor(opts: PanelServerOptions) {
    this.opts = opts;
    this.sessionDir = path.resolve(opts.sessionDir);
    this.server = createServer((req, res) => this.route(req, res));
  }

  async listen(port: number | undefined): Promise<void> {
    const bound = await listen(this.server, port, "127.0.0.1");
    this.url = `http://127.0.0.1:${bound}`;
  }

  private send(res: ServerResponse, status: number, type: string, body: Buffer | string): void {
    // Writing to a response whose client is gone can throw. Nobody is left to
    // see the reply, so swallow it rather than take the server down.
    try {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    } catch {
      // client vanished before the response could be written -- nothing to do.
    }
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    // A request socket that resets mid-flight fires 'error' on the response;
    // without a listener that's an uncaught exception that kills the process.
    res.on("error", () => {});

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", this.url || "http://127.0.0.1").pathname);
    } catch {
      this.send(res, 400, "text/plain", "bad url");
      return;
    }

    if (req.method === "POST" && pathname === "/input") {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body || "{}") as { button?: number; freeze?: boolean };
          if (typeof msg.freeze === "boolean") this.frozen = msg.freeze;
          if (typeof msg.button === "number") {
            this.pressCount++;
            this.opts.onButton(msg.button);
          }
        } catch {
          // A malformed input post is the panel's problem, not the sim's --
          // still ack it so the browser doesn't retry into a wedged state.
        }
        this.send(res, 200, "application/json", "{}");
      });
      req.on("error", () => {});
      return;
    }

    if (pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(
        `event: hello\ndata: ${JSON.stringify({
          deviceId: this.opts.deviceId,
          bundle: this.opts.bundleName,
          width: SCREEN_W,
          height: SCREEN_H,
          frozen: this.frozen,
        })}\n\n`,
      );
      this.clients.add(res);
      const drop = () => this.clients.delete(res);
      req.on("close", drop);
      res.on("close", drop);
      res.on("error", drop);
      return;
    }

    if (pathname.startsWith("/frame/")) {
      const seq = Number(pathname.slice("/frame/".length));
      if (!this.frame || seq !== this.frameSeq) {
        this.send(res, 404, "text/plain", "no such frame");
        return;
      }
      this.send(res, 200, "application/octet-stream", Buffer.from(this.frame));
      return;
    }

    if (pathname.startsWith("/audio/")) {
      const rel = pathname.slice("/audio/".length);
      const abs = path.resolve(this.sessionDir, rel);
      if (abs !== this.sessionDir && !abs.startsWith(this.sessionDir + path.sep)) {
        this.send(res, 403, "text/plain", "forbidden");
        return;
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        this.send(res, 404, "text/plain", "not found");
        return;
      }
      this.send(res, 200, MIME[path.extname(abs)] ?? "application/octet-stream", readFileSync(abs));
      return;
    }

    if (req.method !== "GET") {
      this.send(res, 404, "text/plain", "not found");
      return;
    }

    const name = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const asset = path.resolve(PANEL_DIR, name);
    if (asset.startsWith(PANEL_DIR) && existsSync(asset) && statSync(asset).isFile()) {
      this.send(res, 200, MIME[path.extname(asset)] ?? "application/octet-stream", readFileSync(asset));
      return;
    }
    this.send(res, 404, "text/plain", "not found");
  }

  private broadcast(event: string, data: unknown): void {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) {
      // write() can throw at once for a client that just vanished; drop it
      // without affecting the other subscribers or the caller.
      try {
        c.write(chunk);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  pushFrame(rgb: Uint8Array, seq: number): void {
    this.frame = rgb;
    this.frameSeq = seq;
    this.broadcast("frame", { seq });
  }

  pushSound(e: SoundEvent): void {
    this.broadcast("sound", e);
  }

  pushTelemetry(t: unknown): void {
    this.broadcast("telemetry", t);
  }

  pushLog(level: string, message: string): void {
    this.broadcast("log", { level, message });
  }

  close(): Promise<void> {
    for (const c of this.clients) {
      try {
        c.end();
      } catch {
        // already gone -- fine, we're tearing down anyway.
      }
    }
    this.clients.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      // close() waits for every socket, including idle keep-alive ones that
      // fetch() pools, so close them too or the callback waits for a timeout.
      this.server.closeAllConnections?.();
    });
  }
}

export async function startPanelServer(opts: PanelServerOptions): Promise<PanelServer> {
  const panel = new Panel(opts);
  try {
    await panel.listen(opts.port);
  } catch (err) {
    await panel.close();
    throw new Error(
      `panel server could not bind 127.0.0.1:${opts.port ?? 0}: ${(err as Error).message}` +
        (opts.port ? " (pick a different --port, or drop it to take a random one)" : ""),
    );
  }
  return panel;
}
