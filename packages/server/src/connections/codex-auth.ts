import { readFile, rename, writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { CodexLoginStatus } from "@adv/shared";
import { isRecord, ProviderError, requestJson, type FetchFn } from "./http.ts";

/**
 * Reads the ChatGPT OAuth login that `codex login` (Codex CLI or app) stores in auth.json,
 * the same mechanism Marinara uses. Tokens stay in that file; they are never copied into
 * our database. Refreshing rotates the refresh token, so the file is re-read right before a
 * refresh (another Codex client may have refreshed it already) and written back atomically.
 */

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const REFRESH_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_AFTER_DAYS = 8;
const EXPIRY_SKEW_SECONDS = 60;

export interface CodexAuth {
  accessToken: string;
  accountId: string | null;
  planType: string | null;
}

interface AuthFile {
  tokens?: { access_token?: string; refresh_token?: string; id_token?: unknown; account_id?: string | null } | null;
  last_refresh?: string | null;
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  [key: string]: unknown;
}

export function codexAuthFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return join(home, "auth.json");
}

function decodeJwt(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return isRecord(json) ? json : null;
  } catch {
    return null;
  }
}

const authClaims = (claims: Record<string, unknown> | null) => {
  const nested = claims?.["https://api.openai.com/auth"];
  return isRecord(nested) ? nested : null;
};

function planTypeOf(file: AuthFile): string | null {
  const plan = authClaims(decodeJwt(file.tokens?.id_token))?.chatgpt_plan_type;
  return typeof plan === "string" ? plan : null;
}

function accessExpiry(accessToken: string | undefined): number | null {
  const exp = decodeJwt(accessToken)?.exp;
  return typeof exp === "number" ? exp : null;
}

export function needsRefresh(file: AuthFile, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const exp = accessExpiry(file.tokens?.access_token);
  if (exp !== null && exp <= nowSeconds + EXPIRY_SKEW_SECONDS) return true;
  const last = file.last_refresh ? Date.parse(file.last_refresh) : NaN;
  return Number.isFinite(last) && nowSeconds * 1000 - last > REFRESH_AFTER_DAYS * 86_400_000;
}

async function readAuthFile(path: string): Promise<AuthFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProviderError(`No Codex login found at ${path}. Run \`codex login\` on this computer, then try again.`);
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new ProviderError(`Codex auth file at ${path} is not a JSON object.`);
  return parsed as AuthFile;
}

function toAuth(file: AuthFile, path: string): CodexAuth {
  const tokens = file.tokens;
  if (!tokens?.access_token) {
    const mode = file.auth_mode ?? (file.OPENAI_API_KEY ? "API key" : "unknown");
    throw new ProviderError(`Codex auth at ${path} uses ${mode} login, not ChatGPT. Run \`codex login\` with your ChatGPT account.`);
  }
  const accountId =
    tokens.account_id ??
    (authClaims(decodeJwt(tokens.id_token))?.chatgpt_account_id as string | undefined) ??
    (authClaims(decodeJwt(tokens.access_token))?.chatgpt_account_id as string | undefined) ??
    null;
  return { accessToken: tokens.access_token, accountId, planType: planTypeOf(file) };
}

async function writeAtomically(path: string, file: AuthFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
  await chmod(path, 0o600).catch(() => {});
}

export function createCodexAuth(options: { fetch: FetchFn; path?: string }) {
  const path = options.path ?? codexAuthFilePath();
  let inFlight: Promise<CodexAuth> | null = null;

  async function load(): Promise<CodexAuth> {
    const file = await readAuthFile(path);
    if (!needsRefresh(file)) return toAuth(file, path);

    const refreshToken = file.tokens?.refresh_token;
    if (!refreshToken) throw new ProviderError("The Codex login has expired and cannot be refreshed. Run `codex login` again.");

    const json = await requestJson(
      options.fetch,
      REFRESH_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CODEX_CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken }),
      },
      { label: "ChatGPT login refresh", timeoutMs: 30_000 },
    ).catch((error: unknown) => {
      if (error instanceof ProviderError && (error.status === 400 || error.status === 401)) {
        throw new ProviderError("ChatGPT refused the saved Codex login (it may have been used elsewhere). Run `codex login` again.");
      }
      throw error;
    });
    if (!isRecord(json) || typeof json.access_token !== "string") {
      throw new ProviderError("ChatGPT login refresh returned no access token.");
    }

    // Another Codex client may have rewritten the file meanwhile; merge onto the latest copy.
    const latest = await readAuthFile(path);
    latest.tokens = {
      ...latest.tokens,
      access_token: json.access_token,
      ...(typeof json.refresh_token === "string" ? { refresh_token: json.refresh_token } : {}),
      ...(typeof json.id_token === "string" ? { id_token: json.id_token } : {}),
    };
    latest.last_refresh = new Date().toISOString();
    await writeAtomically(path, latest);
    return toAuth(latest, path);
  }

  return {
    path,

    /** Valid credentials, refreshing when needed. Concurrent callers share one refresh. */
    get(): Promise<CodexAuth> {
      inFlight ??= load().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    /** Login state for the UI. Reads the file only; never refreshes or calls the network. */
    async status(): Promise<CodexLoginStatus> {
      const base: CodexLoginStatus = {
        authFile: path,
        loggedIn: false,
        planType: null,
        accessTokenExpiresAt: null,
        hasRefreshToken: false,
        lastRefresh: null,
        problem: null,
      };
      let file: AuthFile;
      try {
        file = await readAuthFile(path);
      } catch (error) {
        return { ...base, problem: error instanceof Error ? error.message : "Could not read the Codex login." };
      }
      const exp = accessExpiry(file.tokens?.access_token);
      const status: CodexLoginStatus = {
        ...base,
        loggedIn: !!file.tokens?.access_token,
        planType: planTypeOf(file),
        accessTokenExpiresAt: exp ? new Date(exp * 1000).toISOString() : null,
        hasRefreshToken: !!file.tokens?.refresh_token,
        lastRefresh: file.last_refresh ?? null,
      };
      if (!status.loggedIn) status.problem = "auth.json has no ChatGPT login. Run `codex login`.";
      else if (!status.hasRefreshToken && needsRefresh(file)) status.problem = "The login has expired. Run `codex login` again.";
      return status;
    },
  };
}

export type CodexAuthClient = ReturnType<typeof createCodexAuth>;

export function codexHeaders(auth: CodexAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    originator: "marinara-adventure-generator",
    "User-Agent": "MarinaraAdventureGenerator/0.1",
    ...(auth.accountId ? { "ChatGPT-Account-ID": auth.accountId } : {}),
  };
}
