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
