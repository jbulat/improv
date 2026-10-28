import type { Server } from "node:net";

/**
 * Binds `server` and resolves with the bound port. A bind failure, such as a
 * taken port, rejects instead of surfacing as an uncaught 'error' event. After
 * the bind, 'error' events are client-socket faults that request handlers
 * already deal with, so one listener stays for the server's life.
 */
export function listen(server: Server, port: number | undefined, host?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onBindError = (err: Error) => reject(err);
    server.once("error", onBindError);
    const onListening = () => {
      server.removeListener("error", onBindError);
      server.on("error", () => {});
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : (port ?? 0));
    };
    if (host === undefined) server.listen(port ?? 0, onListening);
    else server.listen(port ?? 0, host, onListening);
  });
}

/** Closes a server that may never have finished binding. Never rejects. */
export function closeQuietly(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
