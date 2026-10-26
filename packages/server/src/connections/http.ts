export type FetchFn = typeof fetch;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const SECRET_PATTERNS = [/Bearer\s+[\w.~+/=-]+/gi, /\bsk-[\w-]{8,}/g, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g];

/** Provider error bodies can echo request data; trim them and mask anything token-shaped. */
export function sanitizeProviderText(text: string, max = 300): string {
  let out = text.replace(/\s+/g, " ").trim();
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export interface RequestOptions {
  label: string;
  timeoutMs?: number;
}

/** Rate limits (429): wait and try again, honouring Retry-After, before giving up. */
export const backoff = {
  retries: 4,
  delayMs: (attempt: number, retryAfter: string | null) => {
    const seconds = Number(retryAfter);
    return Math.min(60_000, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000 * 2 ** attempt);
  },
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export async function requestText(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  { label, timeoutMs = 60_000 }: RequestOptions,
): Promise<string> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
      throw new ProviderError(`${label} ${reason}`);
    }
    if (res.status !== 429 || attempt >= backoff.retries) break;
    await res.body?.cancel();
    await backoff.sleep(backoff.delayMs(attempt, res.headers.get("retry-after")));
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`${label} returned ${res.status}: ${sanitizeProviderText(text)}`, res.status);
  return text;
}

export async function requestJson(fetchFn: FetchFn, url: string, init: RequestInit, options: RequestOptions): Promise<unknown> {
  const text = await requestText(fetchFn, url, init, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(`${options.label} did not return JSON: ${sanitizeProviderText(text)}`);
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function positiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Turn an image API result (base64 or URL) into a data URL for preview. */
export async function imageResultToDataUrl(fetchFn: FetchFn, json: unknown, label: string): Promise<string> {
  const item = isRecord(json) && Array.isArray(json.data) ? json.data[0] : undefined;
  if (isRecord(item)) {
    const b64 = typeof item.b64_json === "string" ? item.b64_json : typeof item.image_base64 === "string" ? item.image_base64 : null;
    if (b64) return `data:image/png;base64,${b64}`;
    if (typeof item.url === "string" && /^https:\/\//.test(item.url)) {
      let res: Response;
      try {
        res = await fetchFn(item.url, { signal: AbortSignal.timeout(60_000) });
      } catch {
        throw new ProviderError(`${label} image download failed`);
      }
      if (!res.ok) throw new ProviderError(`${label} image download returned ${res.status}`);
      const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
      if (!type.startsWith("image/")) throw new ProviderError(`${label} image download was not an image`);
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:${type};base64,${bytes.toString("base64")}`;
    }
  }
  const fields = isRecord(json) ? Object.keys(json).join(", ") : typeof json;
  throw new ProviderError(`${label} returned no image (fields: ${fields || "none"})`);
}
