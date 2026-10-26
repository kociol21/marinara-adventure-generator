import sharp from "sharp";
import type { Db } from "../db/database.ts";
import type { ConnectionsRepo } from "../repos/connections.ts";
import { createAdapter, errorMessage, type AdapterDeps } from "../connections/adapters.ts";
import { GenerationError } from "./text.ts";

export const PORTRAIT_SIZE = 768;

/**
 * Images through the connection assigned to the "image" task, with no fallback. Results are
 * cropped to a square portrait: providers do not reliably honour the requested size.
 */
export function createImageGenerator(db: Db, connections: ConnectionsRepo, deps: AdapterDeps) {
  const log = db.prepare(
    "INSERT INTO llm_call (project_id, task, purpose, connection_id, model_id, ok, latency_ms, error, created_at) VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?)",
  );

  const assignment = () => {
    const a = connections.listAssignments().find((x) => x.task === "image");
    const connection = a ? connections.get(a.connectionId) : null;
    return a && connection ? { modelId: a.modelId, connection } : null;
  };

  return {
    /** "Connection · model" when assigned, else null. */
    describe(): string | null {
      const a = assignment();
      return a ? `${a.connection.name} · ${a.modelId}` : null;
    },

    /** One square PNG portrait. Uses image quota or credits. */
    async portrait(prompt: string, projectId: string, purpose: string): Promise<{ png: Buffer; width: number; height: number }> {
      const a = assignment();
      if (!a) throw new GenerationError("No image model is assigned. Choose one under Connections → Task assignments.", "not-assigned");
      const adapter = createAdapter(a.connection, connections.apiKey(a.connection.id), deps);
      const start = Date.now();
      let dataUrl: string;
      try {
        dataUrl = await adapter.generateImage(a.modelId, prompt);
        log.run(projectId, purpose, a.connection.id, a.modelId, 1, Date.now() - start, null, new Date().toISOString());
      } catch (error) {
        log.run(projectId, purpose, a.connection.id, a.modelId, 0, Date.now() - start, errorMessage(error), new Date().toISOString());
        throw new GenerationError(errorMessage(error), "provider");
      }
      const raw = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
      // "attention" keeps the face when a landscape image is cropped to a square.
      const { data, info } = await sharp(raw)
        .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: "cover", position: "attention" })
        .png()
        .toBuffer({ resolveWithObject: true });
      return { png: data, width: info.width, height: info.height };
    },
  };
}

export type ImageGenerator = ReturnType<typeof createImageGenerator>;
