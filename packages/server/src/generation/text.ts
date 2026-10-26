import type { z } from "zod";
import { CONNECTION_KINDS, STORY_PURPOSES } from "@adv/shared";
import type { Db } from "../db/database.ts";
import type { ConnectionsRepo } from "../repos/connections.ts";
import { createAdapter, errorMessage, estimateTokens, type AdapterDeps, type ChatTurn, type Usage } from "../connections/adapters.ts";
import { ProviderError } from "../connections/http.ts";
import { createCallLog } from "./call-log.ts";

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly code: "not-assigned" | "provider" | "invalid-output",
    /** May quote hidden content; shown only behind "Show spoilers". */
    readonly detail?: string,
  ) {
    super(message);
  }
}

export interface GenerateRequest {
  projectId?: string;
  /** Short label for the usage log, e.g. "interview". */
  purpose: string;
  system: string;
  messages: ChatTurn[];
  maxOutputTokens?: number;
}

/** Pull the JSON object out of a model reply: tolerates code fences and prose around it. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("No JSON object in the reply.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Text generation through the connection and model assigned to the "text" task, or to the
 * "story" task for STORY_PURPOSES when the user assigned one. That choice is fixed by the
 * assignments, never by failures: if the model is missing or the provider fails, the caller gets
 * an error (spec §13: never switch provider, model or billing silently).
 */
export function createTextGenerator(db: Db, connections: ConnectionsRepo, deps: AdapterDeps) {
  const log = createCallLog(db, connections);

  async function generate(req: GenerateRequest): Promise<string> {
    const assignments = connections.listAssignments();
    const story = STORY_PURPOSES.has(req.purpose) ? assignments.find((a) => a.task === "story") : undefined;
    const assignment = story ?? assignments.find((a) => a.task === "text");
    const connection = assignment ? connections.get(assignment.connectionId) : null;
    if (!assignment || !connection) {
      throw new GenerationError(
        story ? "The story model's connection is gone. Choose another under Connections → Task assignments." : "No text model is assigned. Choose one under Connections → Task assignments.",
        "not-assigned",
      );
    }
    if (CONNECTION_KINDS[connection.kind].catalog.text === "unsupported") {
      throw new GenerationError(`${connection.name} cannot generate text.`, "not-assigned");
    }
    const adapter = createAdapter(connection, connections.apiKey(connection.id), deps);
    const start = Date.now();
    const call = { projectId: req.projectId ?? null, task: assignment.task, purpose: req.purpose, connectionId: connection.id, modelId: assignment.modelId };
    let usage: Usage | null = null;
    try {
      const text = await adapter.complete({
        modelId: assignment.modelId,
        system: req.system,
        messages: req.messages,
        ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
        onUsage: (u) => (usage = u),
      });
      // Providers that report no usage get an estimate from the request and reply size.
      usage ??= {
        inputTokens: estimateTokens(req.system + req.messages.map((m) => m.content).join("\n")),
        outputTokens: estimateTokens(text),
        estimated: true,
      };
      log({ ...call, ok: true, latencyMs: Date.now() - start, error: null, usage });
      return text;
    } catch (error) {
      const message = errorMessage(error);
      log({ ...call, ok: false, latencyMs: Date.now() - start, error: message });
      throw new GenerationError(error instanceof ProviderError ? message : "The model request failed.", "provider");
    }
  }

  /**
   * Generate and validate a JSON reply. One repair round tells the model what was wrong;
   * the cap keeps a confused model from looping (spec §15).
   */
  async function generateJson<S extends z.ZodType>(
    schema: S,
    req: GenerateRequest,
    repairAttempts = 1,
    /** Extra checks done by code; their problems go back to the model like format errors. */
    check?: (value: z.infer<S>) => string[],
  ): Promise<z.infer<S>> {
    const messages = [...req.messages];
    for (let attempt = 0; ; attempt++) {
      const reply = await generate({ ...req, messages });
      let problem: string;
      let failedChecks = 0;
      try {
        const parsed = schema.safeParse(extractJson(reply));
        if (parsed.success) {
          const problems = check?.(parsed.data) ?? [];
          if (problems.length === 0) return parsed.data;
          failedChecks = problems.length;
          problem = problems.slice(0, 12).join("; ");
        } else {
          problem = parsed.error.issues
            .slice(0, 8)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
        }
      } catch (error) {
        problem = error instanceof Error ? error.message : "Invalid JSON.";
      }
      if (attempt >= repairAttempts) {
        throw failedChecks
          ? new GenerationError(`The output failed ${failedChecks} consistency check(s) after ${attempt + 1} attempt(s).`, "invalid-output", problem)
          : new GenerationError(`The model's reply did not match the expected format (${problem}).`, "invalid-output");
      }
      messages.push(
        { role: "assistant", content: reply },
        { role: "user", content: `Your reply was not valid: ${problem}. Reply again with only the corrected JSON object.` },
      );
    }
  }

  return { generate, generateJson };
}

export type TextGenerator = ReturnType<typeof createTextGenerator>;
