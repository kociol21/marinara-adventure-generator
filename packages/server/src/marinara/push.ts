import { randomUUID } from "node:crypto";
import type { AdventurePackage, PushRecord, PushStep } from "@adv/shared";
import { MarinaraError, type MarinaraClient } from "./client.ts";
import { buildExport, type ExportOptions } from "./export.ts";
import { toNative } from "./native.ts";

/**
 * Push to Marinara (architecture plan §6): the export bundle's files go through Marinara's native
 * import, then a new roleplay chat gets the lorebooks, the Narrative Director with the seeded
 * Secret Plot, the opening scene and (optionally) built vectors. Only new resources are created;
 * when a step fails, everything this push created is deleted again, so a failed push leaves
 * Marinara as it was. The record holds ids, counts and statuses, never story text.
 */

export interface PushOptions {
  withoutSecretPlot: boolean;
  vectorConnectionId: string | null;
}

export class PushRefusedError extends Error {}

type Created = { kind: "character" | "persona" | "lorebook" | "chat"; id: string };

export async function pushToMarinara(
  client: MarinaraClient,
  baseUrl: string,
  pkg: AdventurePackage,
  exportOptions: ExportOptions,
  options: PushOptions,
): Promise<PushRecord> {
  // The same gate as the zip: validation errors or a key in the files stop the push.
  buildExport(pkg, exportOptions);

  const installed = await client.installedPackages();
  const director = installed.includes("director");
  if (!director && !options.withoutSecretPlot) {
    throw new PushRefusedError(
      "The Narrative Director is not installed in this Marinara. Install it there (Agents → Download Agents), or push without the Secret Plot.",
    );
  }
  const vectorBooks = pkg.lorebooks.filter((lb) => lb.vectors.enabled);

  const steps: PushStep[] = [];
  const created: Created[] = [];
  const record: PushRecord = {
    id: randomUUID(),
    pushedAt: new Date().toISOString(),
    baseUrl,
    status: "done",
    chatId: null,
    chatName: pkg.title,
    steps,
    secretPlot: "skipped",
    vectors: vectorBooks.map((lb) => ({ lorebook: lb.name, status: "skipped", vectorized: 0, total: 0 })),
  };
  const step = async <T>(id: string, label: string, run: () => Promise<{ value: T; detail?: string | null }>): Promise<T> => {
    const s: PushStep = { id, label, status: "ok", detail: null };
    steps.push(s);
    try {
      const { value, detail } = await run();
      s.detail = detail ?? null;
      return value;
    } catch (error) {
      s.status = "failed";
      s.detail = error instanceof Error ? error.message : "Unexpected error";
      throw error;
    }
  };

  const native = toNative(pkg, record.pushedAt);
  const opening = pkg.characters.find((c) => c.key === pkg.openingCardKey)!;
  const secretPlot = director && !options.withoutSecretPlot ? pkg.secretPlot : undefined;

  const lorebookIds = new Map<string, string>();
  try {
    const characterIds = new Map<string, string>();
    await step("characters", "Import characters", async () => {
      for (const { card, envelope } of native.characters) {
        const id = await client.importEnvelope(envelope);
        created.push({ kind: "character", id });
        characterIds.set(card.key, id);
      }
      return { value: null, detail: `${characterIds.size} cards` };
    });

    let personaId: string | null = null;
    if (native.persona && pkg.persona) {
      personaId = await step("persona", "Import persona", async () => {
        const id = await client.importEnvelope(native.persona!);
        created.push({ kind: "persona", id });
        return { value: id, detail: pkg.persona!.name };
      });
    }

    await step("lorebooks", "Import lorebooks", async () => {
      for (const { lorebook, envelope } of native.lorebooks) {
        const id = await client.importEnvelope(envelope);
        created.push({ kind: "lorebook", id });
        lorebookIds.set(lorebook.key, id);
      }
      return { value: null, detail: `${lorebookIds.size} lorebooks, ${pkg.lorebooks.reduce((n, lb) => n + lb.entries.length, 0)} entries` };
    });

    // The opening card first, like the roleplay setup in START-HERE.
    const ordered = [opening, ...pkg.characters.filter((c) => c !== opening)].map((c) => characterIds.get(c.key)!);
    const chatId = await step("chat", "Create the roleplay chat", async () => {
      const id = await client.createChat({ name: pkg.title, characterIds: ordered, personaId });
      created.push({ kind: "chat", id });
      return { value: id, detail: pkg.title };
    });
    record.chatId = chatId;

    await step("settings", "Attach lorebooks and agents", async () => {
      await client.patchChatMetadata(chatId, {
        activeLorebookIds: [...lorebookIds.values()],
        ...(secretPlot
          ? { enableAgents: true, activeAgentIds: ["director"], narrativeDirectorSecretPlotEnabled: true }
          : {}),
      });
      return { value: null, detail: secretPlot ? "lorebooks attached, Narrative Director on" : "lorebooks attached" };
    });

    const openingMessageId = await step("opening", "Post the opening scene", async () => ({
      value: await client.createMessage(chatId, { role: "assistant", characterId: characterIds.get(opening.key)!, content: opening.firstMessage }),
      detail: `${opening.name}'s greeting`,
    }));

    if (secretPlot) {
      await step("secret-plot", "Seed the Secret Plot", async () => {
        await client.patchDirectorMemory(chatId, {
          overarchingArc: {
            description: secretPlot.description,
            protagonistArc: secretPlot.protagonistArc,
            ...(secretPlot.characterArc ? { characterArc: secretPlot.characterArc } : {}),
            completed: false,
          },
          sceneDirections: secretPlot.sceneDirections.map((direction) => ({ direction, fulfilled: false })),
          ...(secretPlot.pacing ? { pacing: secretPlot.pacing } : {}),
          // Without this marker the Director rewrites the plan before the first reply (verification §3).
          secretPlotLastAssistantMessageId: openingMessageId,
        });
        return { value: null, detail: `${secretPlot.sceneDirections.length} scene directions` };
      });
      record.secretPlot = "seeded";
    } else {
      steps.push({
        id: "secret-plot",
        label: "Seed the Secret Plot",
        status: "skipped",
        detail: pkg.secretPlot ? "Narrative Director not installed" : "this adventure has no Secret Plot seed",
      });
    }

    // Read back what play depends on; compare without returning any story text.
    await step("verify", "Check the chat in Marinara", async () => {
      const meta = await client.chatMetadata(chatId);
      const attached = Array.isArray(meta.activeLorebookIds) ? (meta.activeLorebookIds as unknown[]) : [];
      const missing = [...lorebookIds.values()].filter((id) => !attached.includes(id));
      if (missing.length) throw new MarinaraError(`${missing.length} lorebook(s) are not attached to the chat.`);
      if (secretPlot) {
        const memory = await client.directorMemory(chatId);
        const arc = memory.overarchingArc as { description?: unknown } | undefined;
        if (typeof arc?.description !== "string" || arc.description.trim() !== secretPlot.description.trim()) {
          throw new MarinaraError("The Secret Plot was not stored as sent.");
        }
        if (memory.secretPlotLastAssistantMessageId !== openingMessageId) {
          throw new MarinaraError("The Secret Plot start marker is missing; the Director would rewrite the plan at once.");
        }
      }
      return { value: null, detail: secretPlot ? "lorebooks attached, Secret Plot stored with its start marker" : "lorebooks attached" };
    });
  } catch (error) {
    record.status = "failed";
    if (record.secretPlot === "seeded") record.secretPlot = "failed";
    record.chatId = null;
    await rollback(client, created, steps);
    return record;
  }

  // Vectors last: a failure here leaves a playable chat (keywords still work), so nothing is undone.
  if (vectorBooks.length) {
    if (!options.vectorConnectionId) {
      steps.push({ id: "vectors", label: "Build lorebook vectors", status: "skipped", detail: "no embedding connection chosen; vectorize in Marinara later" });
    } else {
      const s: PushStep = { id: "vectors", label: "Build lorebook vectors", status: "ok", detail: null };
      steps.push(s);
      for (const [i, v] of record.vectors.entries()) {
        try {
          const r = await client.vectorize(lorebookIds.get(vectorBooks[i]!.key)!, options.vectorConnectionId);
          Object.assign(v, { status: "built", vectorized: r.vectorized, total: r.total });
        } catch (error) {
          v.status = "failed";
          s.status = "failed";
          s.detail = error instanceof Error ? error.message : "Unexpected error";
        }
      }
      if (s.status === "ok") s.detail = record.vectors.map((v) => `${v.lorebook}: ${v.vectorized} of ${v.total}`).join("; ");
    }
  }
  return record;
}

async function rollback(client: MarinaraClient, created: Created[], steps: PushStep[]): Promise<void> {
  const left: string[] = [];
  for (const c of [...created].reverse()) {
    try {
      await client.remove(c.kind, c.id);
    } catch {
      left.push(`${c.kind} ${c.id}`);
    }
  }
  for (const s of steps) if (s.status === "ok") s.status = "undone";
  steps.push({
    id: "rollback",
    label: "Remove what this push created",
    status: left.length ? "failed" : "ok",
    detail: left.length ? `Could not remove: ${left.join(", ")}. Delete them in Marinara.` : `${created.length} created resources removed`,
  });
}
