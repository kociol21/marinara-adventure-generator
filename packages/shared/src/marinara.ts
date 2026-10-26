import { z } from "zod";

/** Secret names for Marinara's HTTP Basic login (BASIC_AUTH_USER / BASIC_AUTH_PASS on the server). */
export const MARINARA_USER_SECRET = "marinara:username";
export const MARINARA_PASSWORD_SECRET = "marinara:password";

/** GET /api/marinara/status: what Push to Marinara would find, without touching anything. */
export interface MarinaraStatus {
  baseUrl: string;
  hasCredentials: boolean;
  reachable: boolean;
  /** False when Marinara asks for a login the app does not have (or has wrong). */
  authenticated: boolean;
  version: string | null;
  /** The Narrative Director package; Secret Plot needs it. Null when unknown. */
  directorInstalled: boolean | null;
  /** Marinara connections that can build lorebook vectors (names only, never keys). */
  embeddingConnections: Array<{ id: string; name: string; embeddingModel: string }>;
  error: string | null;
}

export const pushRequestSchema = z.object({
  /** Push creates resources in Marinara and may spend embedding quota there. */
  confirm: z.literal(true),
  /** Push even when the Narrative Director is not installed; the chat then has no seeded Secret Plot. */
  withoutSecretPlot: z.boolean().default(false),
  /** Marinara connection used to vectorize lorebooks with semantic search on; null skips it. */
  vectorConnectionId: z.string().min(1).nullable().default(null),
});
export type PushRequest = z.input<typeof pushRequestSchema>;

export type PushStepStatus = "ok" | "skipped" | "failed" | "undone";

export interface PushStep {
  id: string;
  label: string;
  status: PushStepStatus;
  /** Spoiler-free: counts, names the player sees, Marinara's own error text. */
  detail: string | null;
}

/** One push of an adventure into a Marinara install. */
export interface PushRecord {
  id: string;
  pushedAt: string;
  baseUrl: string;
  status: "done" | "failed";
  chatId: string | null;
  chatName: string | null;
  steps: PushStep[];
  secretPlot: "seeded" | "skipped" | "failed";
  vectors: Array<{ lorebook: string; status: "built" | "skipped" | "failed"; vectorized: number; total: number }>;
}
