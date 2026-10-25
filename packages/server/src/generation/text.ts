import type { z } from "zod";
import { CONNECTION_KINDS } from "@adv/shared";
import type { Db } from "../db/database.ts";
import type { ConnectionsRepo } from "../repos/connections.ts";
import { createAdapter, errorMessage, type AdapterDeps, type ChatTurn } from "../connections/adapters.ts";
import { ProviderError } from "../connections/http.ts";

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
 * Text generation through the connection and model assigned to the "text" task. There is no
 * fallback: if the assignment is missing or the provider fails, the caller gets an error
 * (spec §13: never switch provider, model or billing silently).
 */
export function createTextGenerator(db: Db, connections: ConnectionsRepo, deps: AdapterDeps) {
  const log = db.prepare(
    "INSERT INTO llm_call (project_id, task, purpose, connection_id, model_id, ok, latency_ms, error, created_at) VALUES (?, 'text', ?, ?, ?, ?, ?, ?, ?)",
  );

  async function generate(req: GenerateRequest): Promise<string> {
    const assignment = connections.listAssignments().find((a) => a.task === "text");
    const connection = assignment ? connections.get(assignment.connectionId) : null;
    if (!assignment || !connection) {
      throw new GenerationError("No text model is assigned. Choose one under Connections → Task assignments.", "not-assigned");
    }
    if (CONNECTION_KINDS[connection.kind].catalog.text === "unsupported") {
      throw new GenerationError(`${connection.name} cannot generate text.`, "not-assigned");
    }
    const adapter = createAdapter(connection, connections.apiKey(connection.id), deps);
    const start = Date.now();
    try {
      const text = await adapter.complete({
        modelId: assignment.modelId,
        system: req.system,
        messages: req.messages,
        ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
      });
      log.run(req.projectId ?? null, req.purpose, connection.id, assignment.modelId, 1, Date.now() - start, null, new Date().toISOString());
      return text;
    } catch (error) {
      const message = errorMessage(error);
      log.run(req.projectId ?? null, req.purpose, connection.id, assignment.modelId, 0, Date.now() - start, message, new Date().toISOString());
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
      let checkFailed = false;
      try {
        const parsed = schema.safeParse(extractJson(reply));
        if (parsed.success) {
          const problems = check?.(parsed.data) ?? [];
          if (problems.length === 0) return parsed.data;
          checkFailed = true;
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
        throw checkFailed
          ? new GenerationError(`The output failed ${problem.split("; ").length} consistency check(s) after ${attempt + 1} attempt(s).`, "invalid-output", problem)
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
