import { z } from "zod";

export const connectionKindSchema = z.enum(["codex-chatgpt", "nano-gpt", "openrouter", "openai-compatible"]);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

export const capabilitySchema = z.enum(["text", "image", "embedding"]);
export type Capability = z.infer<typeof capabilitySchema>;

/**
 * How a provider exposes models for one capability.
 * - catalog: fetched from the provider's own model list
 * - builtin: fixed known model ids (the provider has no list for this capability)
 * - manual: no list; the user types a model id, which stays unconfirmed
 * - unsupported: the provider cannot do this at all
 */
export type CatalogSupport = "catalog" | "builtin" | "manual" | "unsupported";

export interface ConnectionKindInfo {
  kind: ConnectionKind;
  label: string;
  defaultBaseUrl: string;
  needsApiKey: boolean;
  baseUrlEditable: boolean;
  catalog: Record<Capability, CatalogSupport>;
  notes: string;
}

export const CONNECTION_KINDS: Record<ConnectionKind, ConnectionKindInfo> = {
  "codex-chatgpt": {
    kind: "codex-chatgpt",
    label: "ChatGPT (Codex login)",
    defaultBaseUrl: "https://chatgpt.com/backend-api/codex",
    needsApiKey: false,
    baseUrlEditable: false,
    catalog: { text: "catalog", image: "builtin", embedding: "unsupported" },
    notes:
      "Uses the ChatGPT plan behind your local `codex login` (auth.json). This is the endpoint Codex itself uses, not the public OpenAI API, so OpenAI can change it without notice.",
  },
  "nano-gpt": {
    kind: "nano-gpt",
    label: "NanoGPT",
    defaultBaseUrl: "https://nano-gpt.com/api/v1",
    needsApiKey: true,
    baseUrlEditable: true,
    catalog: { text: "catalog", image: "catalog", embedding: "manual" },
    notes: "Aggregator. The text catalog marks which models your subscription covers and which bill your balance.",
  },
  openrouter: {
    kind: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    needsApiKey: true,
    baseUrlEditable: true,
    catalog: { text: "catalog", image: "catalog", embedding: "manual" },
    notes: "Aggregator. Models with a zero price are marked free; everything else bills your credits.",
  },
  "openai-compatible": {
    kind: "openai-compatible",
    label: "OpenAI-compatible API",
    defaultBaseUrl: "",
    needsApiKey: true,
    baseUrlEditable: true,
    catalog: { text: "catalog", image: "manual", embedding: "manual" },
    notes:
      "Any endpoint with /models and /chat/completions. A similar endpoint does not guarantee every feature; test before relying on it.",
  },
};

export const billingSchema = z.enum(["subscription", "paid", "free", "unknown"]);
export type Billing = z.infer<typeof billingSchema>;

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  baseUrl: string;
  /** Whether an API key is stored. The key itself never leaves the server. */
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export const createConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: connectionKindSchema,
  baseUrl: z.string().trim().url().or(z.literal("")).default(""),
  /** Optional on create; stored in the OS credential store. */
  apiKey: z.string().trim().min(1).max(5000).optional(),
});
export type CreateConnectionInput = z.input<typeof createConnectionSchema>;

export const updateConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().trim().url().or(z.literal("")),
  })
  .partial()
  .strict();
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

export const setApiKeySchema = z.object({ apiKey: z.string().trim().min(1).max(5000) });

export interface CatalogModel {
  connectionId: string;
  capability: Capability;
  modelId: string;
  name: string;
  source: "catalog" | "builtin" | "manual";
  billing: Billing;
  /** NanoGPT: input tokens of quota charged per token for subscription models. */
  quotaMultiplier: number | null;
  contextLength: number | null;
  fetchedAt: string;
}

export const addManualModelSchema = z.object({
  capability: capabilitySchema,
  modelId: z.string().trim().min(1).max(300),
});

export interface FetchModelsResult {
  capability: Capability;
  support: CatalogSupport;
  models: CatalogModel[];
}

export const taskSchema = z.enum(["text", "image", "embedding"]);
export type Task = z.infer<typeof taskSchema>;

export interface TaskAssignment {
  task: Task;
  connectionId: string;
  modelId: string;
}

export const setAssignmentSchema = z.object({
  connectionId: z.string().min(1),
  modelId: z.string().trim().min(1).max(300),
});

/** Tests send a real request that may use quota or credits, so the caller must say so explicitly. */
export const testRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(300),
  confirmUsage: z.literal(true),
});

export const fetchModelsSchema = z.object({ capability: capabilitySchema });

export interface TextTestResult {
  ok: boolean;
  modelId: string;
  latencyMs: number;
  /** First characters of the reply, to show the request reached the model. */
  reply?: string;
  error?: string;
}

export interface ImageTestResult {
  ok: boolean;
  modelId: string;
  latencyMs: number;
  /** Small preview of the generated image. */
  imageDataUrl?: string;
  error?: string;
}

export interface CodexLoginStatus {
  authFile: string;
  /** auth.json exists and holds ChatGPT OAuth tokens. */
  loggedIn: boolean;
  planType: string | null;
  accessTokenExpiresAt: string | null;
  hasRefreshToken: boolean;
  lastRefresh: string | null;
  problem: string | null;
}
