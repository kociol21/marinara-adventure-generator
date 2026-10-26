import { isRecord, joinUrl, sanitizeProviderText, type FetchFn } from "../connections/http.ts";
import type { NativeEnvelope } from "./native.ts";

/**
 * Minimal REST client for Marinara Engine 2.5.x, used only by Push to Marinara. It creates new
 * resources and deletes only what it created; it never edits existing data. Login is HTTP Basic
 * (BASIC_AUTH_USER / BASIC_AUTH_PASS on the Marinara server); the header never appears in errors.
 */

export class MarinaraError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface MarinaraCredentials {
  username: string;
  password: string;
}

export interface MarinaraClientOptions {
  baseUrl: string;
  credentials: MarinaraCredentials | null;
  fetch: FetchFn;
  timeoutMs?: number;
}

export type MarinaraClient = ReturnType<typeof createMarinaraClient>;

export function createMarinaraClient(options: MarinaraClientOptions) {
  const auth = options.credentials
    ? `Basic ${Buffer.from(`${options.credentials.username}:${options.credentials.password}`, "utf8").toString("base64")}`
    : null;

  async function call<T = unknown>(method: string, path: string, body?: unknown, timeoutMs = options.timeoutMs ?? 30_000): Promise<T> {
    let res: Response;
    try {
      res = await options.fetch(joinUrl(options.baseUrl, path), {
        method,
        headers: {
          "x-marinara-csrf": "1",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(auth ? { Authorization: auth } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
      throw new MarinaraError(`Marinara ${reason} (${method} ${path.split("?")[0]})`);
    }
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 401 ? " Check the Marinara login in Settings." : "";
      throw new MarinaraError(`Marinara ${method} ${path.split("?")[0]} returned ${res.status}: ${sanitizeProviderText(text, 200)}${hint}`, res.status);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MarinaraError(`Marinara ${method} ${path} did not return JSON`);
    }
  }

  // Marinara stores some booleans as the strings "true" / "false" (SQLite text columns).
  const flag = (value: unknown): boolean => value === true || value === "true" || value === 1;

  const idOf = (value: unknown, what: string): string => {
    if (isRecord(value) && typeof value.id === "string") return value.id;
    throw new MarinaraError(`Marinara did not return an id for the new ${what}.`);
  };

  return {
    /** Open endpoint (no login): version and capability packages. */
    async health(): Promise<{ version: string | null; directorReady: boolean | null }> {
      const h = await call<Record<string, unknown>>("GET", "/api/health", undefined, 10_000);
      const packages = isRecord(h.capabilityPackages) && Array.isArray(h.capabilityPackages.packages) ? h.capabilityPackages.packages : null;
      return {
        version: typeof h.version === "string" ? h.version : null,
        directorReady: packages ? packages.some((p) => isRecord(p) && p.id === "director" && p.ready === true) : null,
      };
    },

    /** Behind the login. Also the authoritative check that Narrative Director is installed. */
    async installedPackages(): Promise<string[]> {
      const list = await call<unknown[]>("GET", "/api/capability-packages/installed", undefined, 10_000);
      return (Array.isArray(list) ? list : []).flatMap((p) => (isRecord(p) && typeof p.id === "string" ? [p.id] : []));
    },

    /** Connections with an embedding model; only id, name and model leave this function. */
    async embeddingConnections(): Promise<Array<{ id: string; name: string; embeddingModel: string }>> {
      const list = await call<unknown[]>("GET", "/api/connections", undefined, 10_000);
      return (Array.isArray(list) ? list : []).flatMap((c) =>
        isRecord(c) && typeof c.id === "string" && typeof c.embeddingModel === "string" && c.embeddingModel.trim()
          ? [{ id: c.id, name: typeof c.name === "string" ? c.name : c.id, embeddingModel: c.embeddingModel }]
          : [],
      );
    },

    /** Connections that can write chat replies; image, video, audio and decision connections are left out. */
    async chatConnections(): Promise<Array<{ id: string; name: string; model: string; isDefault: boolean }>> {
      const list = await call<unknown[]>("GET", "/api/connections", undefined, 10_000);
      const notChat = new Set(["image_generation", "video_generation", "audio_generation", "decision", "tts"]);
      return (Array.isArray(list) ? list : []).flatMap((c) =>
        isRecord(c) && typeof c.id === "string" && !notChat.has(String(c.provider))
          ? [{ id: c.id, name: typeof c.name === "string" ? c.name : c.id, model: typeof c.model === "string" ? c.model : "", isDefault: flag(c.isDefault) }]
          : [],
      );
    },

    async presets(): Promise<Array<{ id: string; name: string; isDefault: boolean }>> {
      const list = await call<unknown[]>("GET", "/api/prompts", undefined, 10_000);
      return (Array.isArray(list) ? list : []).flatMap((p) =>
        isRecord(p) && typeof p.id === "string" ? [{ id: p.id, name: typeof p.name === "string" ? p.name : p.id, isDefault: flag(p.isDefault) }] : [],
      );
    },

    /** Native import: the same route and files as a manual import, so the result matches the export. */
    async importEnvelope(envelope: NativeEnvelope): Promise<string> {
      const res = await call<Record<string, unknown>>("POST", "/api/import/marinara", envelope, 120_000);
      if (res?.success === false) throw new MarinaraError(`Marinara refused the import: ${sanitizeProviderText(String(res.error ?? "unknown error"), 200)}`);
      return idOf(res, envelope.type.replace("marinara_", ""));
    },

    async createChat(input: {
      name: string;
      characterIds: string[];
      personaId: string | null;
      connectionId: string | null;
      promptPresetId: string | null;
    }): Promise<string> {
      return idOf(await call("POST", "/api/chats", { ...input, mode: "roleplay" }), "chat");
    },

    async patchChatMetadata(chatId: string, patch: Record<string, unknown>): Promise<void> {
      await call("PATCH", `/api/chats/${encodeURIComponent(chatId)}/metadata`, patch);
    },

    async chatMetadata(chatId: string): Promise<Record<string, unknown>> {
      const chat = await call<Record<string, unknown>>("GET", `/api/chats/${encodeURIComponent(chatId)}`);
      const meta = chat?.metadata;
      if (typeof meta === "string") {
        try {
          return JSON.parse(meta) as Record<string, unknown>;
        } catch {
          return {};
        }
      }
      return isRecord(meta) ? meta : {};
    },

    async createMessage(chatId: string, input: { role: "assistant"; characterId: string; content: string }): Promise<string> {
      return idOf(await call("POST", `/api/chats/${encodeURIComponent(chatId)}/messages`, { chatId, ...input }), "message");
    },

    async patchDirectorMemory(chatId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
      const res = await call<Record<string, unknown>>("PATCH", `/api/agents/memory/director/${encodeURIComponent(chatId)}`, { patch });
      return isRecord(res?.memory) ? res.memory : {};
    },

    async directorMemory(chatId: string): Promise<Record<string, unknown>> {
      const res = await call<Record<string, unknown>>("GET", `/api/agents/memory/director/${encodeURIComponent(chatId)}`);
      return isRecord(res?.memory) ? res.memory : {};
    },

    async vectorize(lorebookId: string, connectionId: string): Promise<{ vectorized: number; total: number }> {
      const res = await call<Record<string, unknown>>(
        "POST",
        `/api/lorebooks/${encodeURIComponent(lorebookId)}/vectorize`,
        { connectionId, onlyMissing: false },
        600_000,
      );
      return { vectorized: Number(res?.vectorized ?? 0), total: Number(res?.total ?? 0) };
    },

    /** Removal of resources this client created, for rollback after a failed push. */
    async remove(kind: "character" | "persona" | "lorebook" | "chat", id: string): Promise<void> {
      const path = {
        character: `/api/characters/${encodeURIComponent(id)}`,
        persona: `/api/characters/personas/${encodeURIComponent(id)}`,
        lorebook: `/api/lorebooks/${encodeURIComponent(id)}`,
        chat: `/api/chats/${encodeURIComponent(id)}`,
      }[kind];
      await call("DELETE", path);
    },
  };
}
