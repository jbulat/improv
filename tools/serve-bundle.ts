// OTA story delivery, Mac side: the story_fetch manifest (--manifest) and the
// ephemeral HTTP server (default) that the device pulls a bundle's audio from.
import { readFileSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import { loadBundle } from "./lib/bundle";
import { PORT, parseCli, runCli } from "./lib/cli";
import { loadTroupe } from "./lib/troupe";
import { validatePerformance } from "./lib/validator";
import { stagedAudioFiles } from "./lib/staging";
import { crc32Hex } from "./lib/crc32";
import { closeQuietly, listen } from "./lib/listen";

export interface ManifestFile {
  path: string;
  size: number;
  crc32: string;
}
export interface BundleManifest {
  bundle: string;
  files: ManifestFile[];
}

/** Validate the bundle (with --check-files strictness), then describe its
 *  staged audio set the way the story_fetch announce carries it. */
export function buildManifest(bundleDir: string): BundleManifest {
  const bundle = loadBundle(bundleDir);
  const troupe = loadTroupe();
  const result = validatePerformance(bundle.perf, troupe, { checkFilesDir: bundle.dir });
  if (!result.ok) {
    const detail = result.errors.map((e) => `  ${e.path} ${e.message}`).join("\n");
    throw new Error(`${bundle.name} failed validation:\n${detail}`);
  }
  const files = stagedAudioFiles(bundle).map(({ src, base }) => ({
    path: base,
    size: statSync(src).size,
    crc32: crc32Hex(readFileSync(src)),
  }));
  return { bundle: bundle.name, files };
}

type Interfaces = Record<string, { family: string; address: string; internal: boolean }[] | undefined>;

/** 10/8, 172.16/12 or 192.168/16: the only hosts the device fetches from. */
function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The base_url host the device can reach on the LAN: the first private
 *  IPv4, so a VPN address listed first is passed over, else the first
 *  external IPv4, else loopback. */
export function pickLanHost(interfaces: Interfaces): string {
  const external = Object.values(interfaces)
    .flatMap((infos) => infos ?? [])
    .filter((info) => info.family === "IPv4" && !info.internal);
  return (external.find((info) => isPrivateIPv4(info.address)) ?? external[0])?.address ?? "127.0.0.1";
}

export function lanHost(): string {
  return pickLanHost(os.networkInterfaces());
}

export interface ServeOptions {
  port?: number; // default 0 = random high port
  host?: string; // default lanHost(); tests pass 127.0.0.1
  log?: (line: string) => void; // default console.log; one JSON line per request
}
export interface BundleServer {
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}

export async function createBundleServer(bundleDir: string, opts: ServeOptions = {}): Promise<BundleServer> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const bundle = loadBundle(bundleDir);
  buildManifest(bundleDir); // validation gate — refuse to serve a broken bundle
  const allow = new Map<string, string>(); // url path -> file on disk
  for (const { src, base } of stagedAudioFiles(bundle)) allow.set(`/${bundle.name}/${base}`, src);
  const sentinel = `/${bundle.name}/.already`;

  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    const remote = req.socket.remoteAddress ?? "?";
    const reply = (status: number, bytes: number, body?: Buffer) => {
      res.writeHead(status, body ? { "content-type": "audio/wav", "content-length": bytes } : {});
      res.end(body);
      log(JSON.stringify({ path: url, status, bytes, remote }));
    };
    if (req.method !== "GET") return reply(405, 0);
    if (url === sentinel) return reply(204, 0);
    const src = allow.get(url);
    if (!src) return reply(404, 0);
    const body = readFileSync(src);
    reply(200, body.length, body);
  });
  let port: number;
  try {
    port = await listen(server, opts.port);
  } catch (err) {
    await closeQuietly(server);
    throw new Error(`bundle server could not bind port ${opts.port ?? 0}: ${(err as Error).message}`);
  }
  const host = opts.host ?? lanHost();
  return {
    port,
    baseUrl: `http://${host}:${port}/${bundle.name}/`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // server.close() alone waits for existing connections (including idle
        // keep-alives) to end on their own — a device or client holding one
        // open would stall shutdown indefinitely. Force them shut so close()
        // resolves promptly. (Node >=20, this repo's floor; safe no-op if already closed.)
        server.closeAllConnections();
      }),
  };
}

/** --manifest prints the manifest. Otherwise the server runs until --timeout
 *  seconds pass or the process is interrupted. */
export async function main(argv: string[]): Promise<void> {
  const { values } = parseCli(argv, {
    usage:
      "usage: npm run serve:bundle -- --bundle <dir> [--manifest] [--port <n>] [--host <ip>] [--timeout <seconds>]",
    options: {
      bundle: { type: "string", required: true },
      manifest: { type: "boolean" },
      port: { ...PORT, default: 0 },
      host: { type: "string" },
      timeout: { type: "number", min: 0, default: 600 },
    },
  });
  if (values.manifest) {
    console.log(JSON.stringify(buildManifest(values.bundle), null, 2));
    return;
  }
  const srv = await createBundleServer(values.bundle, { port: values.port, host: values.host });
  console.log(`serving ${srv.baseUrl}`);
  const stop = () => void srv.close().then(() => process.exit(0));
  const timer = setTimeout(stop, values.timeout * 1000);
  timer.unref();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

runCli(import.meta.url, main);
