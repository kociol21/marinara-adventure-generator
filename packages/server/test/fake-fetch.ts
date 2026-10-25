import type { FetchFn } from "../src/connections/http.ts";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (req: RecordedRequest) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

/** A fetch stand-in routed by "METHOD url-substring"; records every request it serves. */
export function fakeFetch(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const fn: FetchFn = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const req = { url, method, headers, body };
    requests.push(req);
    const key = Object.keys(routes).find((k) => {
      const [m, ...rest] = k.split(" ");
      return m === method && url.includes(rest.join(" "));
    });
    if (!key) return new Response(JSON.stringify({ error: `no fake route for ${method} ${url}` }), { status: 599 });
    const out = routes[key]!(req);
    const payload = out.text ?? JSON.stringify(out.json ?? {});
    return new Response(payload, { status: out.status ?? 200, headers: out.headers ?? { "content-type": "application/json" } });
  };
  return { fetch: fn, requests };
}

export function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}
