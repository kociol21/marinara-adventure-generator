/** Header every state-changing request from the web app must carry (CSRF guard). */
export const CSRF_HEADER = "x-adv-csrf";
export const CSRF_HEADER_VALUE = "1";

export const DEFAULT_PORT = 7880;

/** All generated content and the UI are English, whatever language the user types in. */
export const CONTENT_LANGUAGE = "en";

export interface ApiError {
  error: string;
  issues?: unknown;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  dataDir: string;
  secretStore: "os-keyring" | "file" | "memory";
}

/** Latest release on GitHub, when "Check for updates" is on and GitHub answered. */
export interface UpdateInfo {
  enabled: boolean;
  current: string;
  latest: string | null;
  /** Release page on github.com. */
  url: string | null;
  newer: boolean;
}

/** Totals for a group of model requests. Token counts and cost cover only the calls that reported them. */
export interface UsageTotals {
  requests: number;
  failed: number;
  images: number;
  inputTokens: number;
  outputTokens: number;
  /** USD, for calls with a known price; subscription calls count as 0. */
  costUsd: number;
  /** Calls whose price is unknown (no usage reported, or no list price). */
  unpricedCalls: number;
  /** Subscription quota used: input tokens times the model's quota multiplier. */
  quotaTokens: number;
  /** Some token counts are estimates (about four characters per token). */
  estimated: boolean;
}

/** What one adventure has used so far, in total and per stage. */
export interface ProjectUsage {
  total: UsageTotals;
  /** Grouped by stage: "interview", "plan", "lorebook", "card", "avatar", "audit", and so on. */
  stages: Array<{ stage: string } & UsageTotals>;
}

/** Forecast for one generation run, from earlier adventures and the current text model. */
export interface UsageEstimate {
  /** Finished adventures the averages come from; 0 means no forecast. */
  basedOn: number;
  requests: number;
  images: number;
  /** Null until an earlier adventure recorded token counts. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Text model assigned now and how it is billed. */
  model: string | null;
  billing: "subscription" | "paid" | "free" | "unknown";
  /** USD at the current text model's list price, when it has one. */
  costUsd: number | null;
  /** Subscription quota at the current model's multiplier. */
  quotaTokens: number | null;
}
