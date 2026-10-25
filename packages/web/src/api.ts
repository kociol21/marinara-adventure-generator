import { CSRF_HEADER, CSRF_HEADER_VALUE, type ApiError } from "@adv/shared";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(describe(body));
  }
}

/** Prefer the first validation issue ("marinaraBaseUrl: Invalid URL") over the generic error. */
function describe(body: ApiError): string {
  const issue = Array.isArray(body.issues) ? (body.issues[0] as { path?: unknown[]; message?: string }) : undefined;
  if (!issue?.message) return body.error;
  const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { [CSRF_HEADER]: CSRF_HEADER_VALUE } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiRequestError(res.status, json as ApiError);
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: (path: string) => request<void>("DELETE", path),
};
