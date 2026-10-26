import { randomUUID } from "node:crypto";
import {
  CONNECTION_KINDS,
  type Capability,
  type CatalogSupport,
  type Connection,
  type ImageTestResult,
  type TextTestResult,
} from "@adv/shared";
import type { CatalogEntry } from "../repos/connections.ts";
import { CODEX_BASE_URL, codexHeaders, type CodexAuthClient } from "./codex-auth.ts";
import {
  imageResultToDataUrl,
  isRecord,
  joinUrl,
  positiveInt,
  ProviderError,
  requestJson,
  requestText,
  type FetchFn,
} from "./http.ts";

/** The probe prompt for text tests: tiny, neutral, and in English like all content. */
const TEXT_TEST_PROMPT = "Reply with exactly one word: ready";
const IMAGE_TEST_PROMPT = "A small red apple on a plain white table, simple flat illustration";

/**
 * The ChatGPT catalog only lists models whose `minimal_client_version` is at or below this
 * (verified 2026-10-25: "0.1.0" returns nothing, Codex 0.x minimums are met by "1.0.0").
 */
const CODEX_CLIENT_VERSION = "1.0.0";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** Data URLs of images to show the model with this turn (vision). */
  images?: string[];
}

export interface CompletionRequest {
  modelId: string;
  system: string;
  messages: ChatTurn[];
  /** Ignored by ChatGPT (Codex), which takes no output limit. */
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ProviderAdapter {
  support(capability: Capability): CatalogSupport;
  /** Reads the provider's model list. Never generates anything. */
  listModels(capability: Capability): Promise<CatalogEntry[]>;
  /** One text generation. Real request: uses quota or credits. */
  complete(request: CompletionRequest): Promise<string>;
  testText(modelId: string): Promise<string>;
  testImage(modelId: string): Promise<string>;
  /** One image as a data URL. Real request: uses quota or credits. The size is a request, not a guarantee. */
  generateImage(modelId: string, prompt: string): Promise<string>;
  /** Embedding vectors, one per text, in order. */
  embed(modelId: string, texts: string[]): Promise<number[][]>;
}

export interface AdapterDeps {
  fetch: FetchFn;
  codexAuth: CodexAuthClient;
}

function entry(modelId: string, name: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
  return { modelId, name: name || modelId, source: "catalog", billing: "unknown", quotaMultiplier: null, contextLength: null, ...extra };
}

const dataArray = (json: unknown): Record<string, unknown>[] =>
  isRecord(json) && Array.isArray(json.data) ? json.data.filter(isRecord) : [];

class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(
    protected readonly connection: Connection,
    protected readonly apiKey: string | null,
    protected readonly fetch: FetchFn,
  ) {}

  protected get label() {
    return this.connection.name;
  }

  protected get baseUrl() {
    if (!this.connection.baseUrl) throw new ProviderError(`${this.label} has no base URL.`);
    return this.connection.baseUrl;
  }

  protected headers(json = false): Record<string, string> {
    if (!this.apiKey && CONNECTION_KINDS[this.connection.kind].needsApiKey) {
      throw new ProviderError(`${this.label} has no API key. Add one in the connection settings.`);
    }
    return {
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  support(capability: Capability): CatalogSupport {
    return CONNECTION_KINDS[this.connection.kind].catalog[capability];
  }

  async listModels(capability: Capability): Promise<CatalogEntry[]> {
    if (capability !== "text") return [];
    const json = await requestJson(this.fetch, joinUrl(this.baseUrl, "models"), { headers: this.headers() }, { label: `${this.label} model list` });
    return dataArray(json)
      .filter((m) => typeof m.id === "string")
      .map((m) => entry(m.id as string, typeof m.name === "string" ? m.name : (m.id as string), { contextLength: positiveInt(m.context_length) }));
  }

  async complete({ modelId, system, messages, maxOutputTokens, timeoutMs }: CompletionRequest): Promise<string> {
    const json = await requestJson(
      this.fetch,
      joinUrl(this.baseUrl, "chat/completions"),
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({
          model: modelId,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            ...messages.map((m) =>
              m.images?.length
                ? {
                    role: m.role,
                    content: [{ type: "text", text: m.content }, ...m.images.map((url) => ({ type: "image_url", image_url: { url } }))],
                  }
                : { role: m.role, content: m.content },
            ),
          ],
          ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
          stream: false,
        }),
      },
      { label: `${this.label} (${modelId})`, timeoutMs: timeoutMs ?? 300_000 },
    );
    const choice = isRecord(json) && Array.isArray(json.choices) ? json.choices[0] : undefined;
    const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined;
    if (typeof content !== "string") throw new ProviderError(`${this.label} returned no text.`);
    return content;
  }

  testText(modelId: string): Promise<string> {
    return this.complete({ modelId, system: "", messages: [{ role: "user", content: TEXT_TEST_PROMPT }], maxOutputTokens: 200, timeoutMs: 60_000 });
  }

  async embed(modelId: string, texts: string[]): Promise<number[][]> {
    const json = await requestJson(
      this.fetch,
      joinUrl(this.baseUrl, "embeddings"),
      { method: "POST", headers: this.headers(true), body: JSON.stringify({ model: modelId, input: texts }) },
      { label: `${this.label} embeddings (${modelId})`, timeoutMs: 120_000 },
    );
    const rows = dataArray(json)
      .slice()
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
      .map((r) => r.embedding);
    if (rows.length !== texts.length || !rows.every((v) => Array.isArray(v) && v.every((x) => typeof x === "number"))) {
      throw new ProviderError(`${this.label} returned ${rows.length} embeddings for ${texts.length} texts.`);
    }
    return rows as number[][];
  }

  protected imagesUrl(): string {
    return joinUrl(this.baseUrl, "images/generations");
  }

  async generateImage(modelId: string, prompt: string): Promise<string> {
    const json = await requestJson(
      this.fetch,
      this.imagesUrl(),
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ model: modelId, prompt, n: 1, size: "1024x1024" }),
      },
      { label: `${this.label} image (${modelId})`, timeoutMs: 180_000 },
    );
    return imageResultToDataUrl(this.fetch, json, this.label);
  }

  testImage(modelId: string): Promise<string> {
    return this.generateImage(modelId, IMAGE_TEST_PROMPT);
  }
}

class NanoGptAdapter extends OpenAICompatibleAdapter {
  override async listModels(capability: Capability): Promise<CatalogEntry[]> {
    if (capability === "text") {
      const json = await requestJson(this.fetch, joinUrl(this.baseUrl, "models?detailed=true"), { headers: this.headers() }, {
        label: `${this.label} text model list`,
      });
      return dataArray(json)
        .filter((m) => typeof m.id === "string")
        .map((m) => {
          const sub = isRecord(m.subscription) ? m.subscription : null;
          const included = typeof sub?.included === "boolean" ? sub.included : undefined;
          const multiplier = typeof sub?.inputTokenMultiplier === "number" ? sub.inputTokenMultiplier : null;
          return entry(m.id as string, typeof m.name === "string" ? m.name : (m.id as string), {
            billing: included === true ? "subscription" : included === false ? "paid" : "unknown",
            // An excluded model reports 1, which would read as full coverage; keep it only when included.
            quotaMultiplier: included === true ? multiplier : null,
            contextLength: positiveInt(m.context_length),
          });
        });
    }
    if (capability === "image") {
      const json = await requestJson(this.fetch, joinUrl(this.baseUrl, "image-models"), { headers: this.headers() }, {
        label: `${this.label} image model list`,
      });
      return dataArray(json)
        .filter((m) => typeof m.id === "string")
        .map((m) => entry(m.id as string, typeof m.name === "string" ? m.name : (m.id as string)));
    }
    return [];
  }

  /** NanoGPT serves images under /v1/images/generations, not under the /api/v1 text prefix. */
  protected override imagesUrl(): string {
    const url = new URL(this.baseUrl);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path.endsWith("/api/v1") ? `${path.slice(0, -"/api/v1".length)}/v1/images/generations` : `${path}/images/generations`;
    return url.toString();
  }
}

class OpenRouterAdapter extends OpenAICompatibleAdapter {
  override async listModels(capability: Capability): Promise<CatalogEntry[]> {
    if (capability === "embedding") return [];
    const path = capability === "image" ? "models?output_modalities=image" : "models";
    const json = await requestJson(this.fetch, joinUrl(this.baseUrl, path), { headers: this.headers() }, {
      label: `${this.label} ${capability} model list`,
    });
    return dataArray(json)
      .filter((m) => typeof m.id === "string")
      .filter((m) => {
        const arch = isRecord(m.architecture) ? m.architecture : null;
        const outputs = Array.isArray(arch?.output_modalities) ? arch.output_modalities : null;
        return !outputs || outputs.includes(capability === "image" ? "image" : "text");
      })
      .map((m) => {
        const pricing = isRecord(m.pricing) ? m.pricing : null;
        const free = pricing && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0;
        return entry(m.id as string, typeof m.name === "string" ? m.name : (m.id as string), {
          billing: pricing ? (free ? "free" : "paid") : "unknown",
          contextLength: positiveInt(m.context_length),
        });
      });
  }
}

/** Parse the Responses API event stream, collecting output text. */
function collectResponsesText(sse: string): string {
  let text = "";
  let completed: string | null = null;
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
    if (event.type === "response.failed" || event.type === "error") {
      const err = isRecord(event.response) && isRecord(event.response.error) ? event.response.error : event.error;
      const message = isRecord(err) && typeof err.message === "string" ? err.message : "The request failed.";
      throw new ProviderError(`ChatGPT: ${message}`);
    }
    if (event.type === "response.completed" && isRecord(event.response) && Array.isArray(event.response.output)) {
      completed = event.response.output
        .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("");
    }
  }
  return text || completed || "";
}

class CodexAdapter implements ProviderAdapter {
  private readonly label = "ChatGPT (Codex login)";

  constructor(
    private readonly fetch: FetchFn,
    private readonly auth: CodexAuthClient,
  ) {}

  support(capability: Capability): CatalogSupport {
    return CONNECTION_KINDS["codex-chatgpt"].catalog[capability];
  }

  async listModels(capability: Capability): Promise<CatalogEntry[]> {
    if (capability === "image") {
      // Codex has no image model list; gpt-image-2 is the model Codex itself uses for images.
      return [entry("gpt-image-2", "GPT Image 2", { source: "builtin", billing: "subscription" })];
    }
    if (capability !== "text") return [];
    const auth = await this.auth.get();
    const json = await requestJson(
      this.fetch,
      joinUrl(CODEX_BASE_URL, `models?client_version=${CODEX_CLIENT_VERSION}`),
      { headers: codexHeaders(auth) },
      { label: `${this.label} model list` },
    );
    const models = isRecord(json) && Array.isArray(json.models) ? json.models.filter(isRecord) : [];
    return models
      .filter((m) => m.visibility !== "hide")
      .map((m) => {
        const id = typeof m.slug === "string" ? m.slug : typeof m.id === "string" ? m.id : null;
        if (!id) return null;
        const name = typeof m.display_name === "string" ? m.display_name : typeof m.name === "string" ? m.name : id;
        return entry(id, name, { billing: "subscription", contextLength: positiveInt(m.context_window) });
      })
      .filter((m): m is CatalogEntry => m !== null);
  }

  async complete({ modelId, system, messages, timeoutMs }: CompletionRequest): Promise<string> {
    const auth = await this.auth.get();
    // Same request shape Marinara sends: Codex requires instructions and streaming, and takes no sampling params.
    const sse = await requestText(
      this.fetch,
      joinUrl(CODEX_BASE_URL, "responses"),
      {
        method: "POST",
        headers: { ...codexHeaders(auth), "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          model: modelId,
          instructions: system || "You are a helpful assistant.",
          input: messages.map((m) => ({
            role: m.role,
            content: [
              { type: m.role === "assistant" ? "output_text" : "input_text", text: m.content },
              ...(m.images ?? []).map((url) => ({ type: "input_image", image_url: url })),
            ],
          })),
          store: false,
          stream: true,
        }),
      },
      { label: `${this.label} (${modelId})`, timeoutMs: timeoutMs ?? 300_000 },
    );
    return collectResponsesText(sse);
  }

  testText(modelId: string): Promise<string> {
    return this.complete({ modelId, system: "", messages: [{ role: "user", content: TEXT_TEST_PROMPT }], timeoutMs: 120_000 });
  }

  embed(): Promise<number[][]> {
    return Promise.reject(new ProviderError("ChatGPT (Codex login) has no embedding models."));
  }

  async generateImage(modelId: string, prompt: string): Promise<string> {
    const auth = await this.auth.get();
    const json = await requestJson(
      this.fetch,
      joinUrl(CODEX_BASE_URL, "images/generations"),
      {
        method: "POST",
        headers: { ...codexHeaders(auth), "Content-Type": "application/json", "x-codex-image-turn-id": randomUUID() },
        // The endpoint may ignore size (verified 2026-10-25: 1536x1024 for 1024x1024); callers crop.
        body: JSON.stringify({ model: modelId, prompt, background: "opaque", quality: "auto", size: "1024x1024" }),
      },
      { label: `${this.label} image (${modelId})`, timeoutMs: 180_000 },
    );
    return imageResultToDataUrl(this.fetch, json, this.label);
  }

  testImage(modelId: string): Promise<string> {
    return this.generateImage(modelId, IMAGE_TEST_PROMPT);
  }
}

export function createAdapter(connection: Connection, apiKey: string | null, deps: AdapterDeps): ProviderAdapter {
  switch (connection.kind) {
    case "codex-chatgpt":
      return new CodexAdapter(deps.fetch, deps.codexAuth);
    case "nano-gpt":
      return new NanoGptAdapter(connection, apiKey, deps.fetch);
    case "openrouter":
      return new OpenRouterAdapter(connection, apiKey, deps.fetch);
    case "openai-compatible":
      return new OpenAICompatibleAdapter(connection, apiKey, deps.fetch);
  }
}

export async function runTextTest(adapter: ProviderAdapter, modelId: string): Promise<TextTestResult> {
  const start = Date.now();
  try {
    const reply = await adapter.testText(modelId);
    return { ok: true, modelId, latencyMs: Date.now() - start, reply: reply.trim().slice(0, 200) };
  } catch (error) {
    return { ok: false, modelId, latencyMs: Date.now() - start, error: errorMessage(error) };
  }
}

export async function runImageTest(adapter: ProviderAdapter, modelId: string): Promise<ImageTestResult> {
  const start = Date.now();
  try {
    const imageDataUrl = await adapter.testImage(modelId);
    return { ok: true, modelId, latencyMs: Date.now() - start, imageDataUrl };
  } catch (error) {
    return { ok: false, modelId, latencyMs: Date.now() - start, error: errorMessage(error) };
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof ProviderError ? error.message : "Unexpected error while contacting the provider.";
}
