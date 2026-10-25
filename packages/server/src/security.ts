import type { FastifyInstance } from "fastify";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@adv/shared";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isTrustedHost(hostHeader: string | undefined, ports: number[]): boolean {
  if (!hostHeader) return false;
  try {
    const url = new URL(`http://${hostHeader}`);
    return LOOPBACK_HOSTS.has(url.hostname) && ports.includes(Number(url.port || 80));
  } catch {
    return false;
  }
}

/**
 * The app listens on loopback only, but a web page in the user's browser could still try to
 * reach it. Host validation blocks DNS-rebinding; the custom header blocks cross-site writes
 * (a plain HTML form or no-cors fetch cannot set it).
 */
export function installSecurityHooks(app: FastifyInstance, options: { ports: number[] }): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!isTrustedHost(req.headers.host, options.ports)) {
      return reply.status(403).send({ error: "Untrusted host" });
    }
    if (!UNSAFE_METHODS.has(req.method)) return;

    if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      return reply.status(403).send({ error: "Missing CSRF header" });
    }
    const origin = req.headers.origin;
    if (origin) {
      let host: string | undefined;
      try {
        host = new URL(origin).host;
      } catch {
        host = undefined;
      }
      if (!isTrustedHost(host, options.ports)) {
        return reply.status(403).send({ error: "Untrusted origin" });
      }
    }
  });
}
