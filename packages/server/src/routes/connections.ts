import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  addManualModelSchema,
  capabilitySchema,
  CONNECTION_KINDS,
  createConnectionSchema,
  fetchModelsSchema,
  setApiKeySchema,
  setAssignmentSchema,
  TASK_CAPABILITY,
  taskSchema,
  testRequestSchema,
  updateConnectionSchema,
  type Capability,
  type Connection,
  type FetchModelsResult,
} from "@adv/shared";
import type { ConnectionsRepo } from "../repos/connections.ts";
import { createAdapter, errorMessage, runDecisionTest, runImageTest, runTextTest, type AdapterDeps } from "../connections/adapters.ts";
import { CODEX_BASE_URL } from "../connections/codex-auth.ts";

interface Options {
  connections: ConnectionsRepo;
  adapterDeps: AdapterDeps;
}

const notFound = (reply: FastifyReply) => reply.status(404).send({ error: "Connection not found" });

export const connectionRoutes: FastifyPluginAsync<Options> = async (app, { connections, adapterDeps }) => {
  const adapterFor = (connection: Connection) => createAdapter(connection, connections.apiKey(connection.id), adapterDeps);

  app.get("/", async () => connections.list());

  app.post("/", async (req, reply) => {
    const input = createConnectionSchema.parse(req.body);
    const info = CONNECTION_KINDS[input.kind];
    const baseUrl = info.baseUrlEditable ? input.baseUrl || info.defaultBaseUrl : CODEX_BASE_URL;
    if (!baseUrl) return reply.status(400).send({ error: "This connection type needs a base URL." });
    const created = connections.create({
      name: input.name,
      kind: input.kind,
      baseUrl,
      ...(info.needsApiKey && input.apiKey ? { apiKey: input.apiKey } : {}),
    });
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const input = updateConnectionSchema.parse(req.body);
    const current = connections.get(req.params.id);
    if (!current) return notFound(reply);
    if (input.baseUrl !== undefined && !CONNECTION_KINDS[current.kind].baseUrlEditable) {
      return reply.status(400).send({ error: "This connection's address is fixed." });
    }
    return connections.update(current.id, input);
  });

  app.put<{ Params: { id: string } }>("/:id/api-key", async (req, reply) => {
    const { apiKey } = setApiKeySchema.parse(req.body);
    const current = connections.get(req.params.id);
    if (!current) return notFound(reply);
    if (!CONNECTION_KINDS[current.kind].needsApiKey) return reply.status(400).send({ error: "This connection does not use an API key." });
    connections.setApiKey(current.id, apiKey);
    return connections.get(current.id);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!connections.delete(req.params.id)) return notFound(reply);
    return reply.status(204).send();
  });

  // ── Model catalogs: one capability per request, so text and image lists are fetched separately ──

  app.get<{ Params: { id: string }; Querystring: { capability?: string } }>("/:id/models", async (req, reply) => {
    if (!connections.get(req.params.id)) return notFound(reply);
    const capability = req.query.capability ? capabilitySchema.parse(req.query.capability) : undefined;
    return connections.listModels(req.params.id, capability);
  });

  app.post<{ Params: { id: string } }>("/:id/models/fetch", async (req, reply) => {
    const { capability } = fetchModelsSchema.parse(req.body);
    const connection = connections.get(req.params.id);
    if (!connection) return notFound(reply);
    const adapter = adapterFor(connection);
    const support = adapter.support(capability);
    if (support === "unsupported") {
      return reply.status(400).send({ error: `${CONNECTION_KINDS[connection.kind].label} does not offer ${capability} models.` });
    }
    if (support === "manual") {
      return reply.status(400).send({ error: `${CONNECTION_KINDS[connection.kind].label} has no ${capability} model list. Enter the model id manually.` });
    }
    try {
      const entries = await adapter.listModels(capability);
      const result: FetchModelsResult = { capability, support, models: connections.replaceCatalog(connection.id, capability, entries) };
      return result;
    } catch (error) {
      return reply.status(502).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/:id/models", async (req, reply) => {
    const { capability, modelId } = addManualModelSchema.parse(req.body);
    const connection = connections.get(req.params.id);
    if (!connection) return notFound(reply);
    if (CONNECTION_KINDS[connection.kind].catalog[capability] === "unsupported") {
      return reply.status(400).send({ error: `${CONNECTION_KINDS[connection.kind].label} does not offer ${capability} models.` });
    }
    return reply.status(201).send(connections.addManualModel(connection.id, capability, modelId));
  });

  app.delete<{ Params: { id: string; capability: string; modelId: string } }>("/:id/models/:capability/:modelId", async (req, reply) => {
    const capability = capabilitySchema.parse(req.params.capability);
    if (!connections.removeModel(req.params.id, capability, req.params.modelId)) {
      return reply.status(404).send({ error: "Model not found" });
    }
    return reply.status(204).send();
  });

  // ── ChatGPT (Codex) login state: reads auth.json only, no network ──

  app.get<{ Params: { id: string } }>("/:id/codex-status", async (req, reply) => {
    const connection = connections.get(req.params.id);
    if (!connection) return notFound(reply);
    if (connection.kind !== "codex-chatgpt") return reply.status(400).send({ error: "Not a ChatGPT (Codex) connection." });
    return adapterDeps.codexAuth.status();
  });

  // ── Tests: real requests that may use quota or credits; each is a separate explicit action ──

  app.post<{ Params: { id: string } }>("/:id/test-text", async (req, reply) => {
    const { modelId } = testRequestSchema.parse(req.body);
    const connection = connections.get(req.params.id);
    if (!connection) return notFound(reply);
    if (CONNECTION_KINDS[connection.kind].catalog.text === "unsupported") return reply.status(400).send({ error: "No text models here." });
    return runTextTest(adapterFor(connection), modelId);
  });

  app.post<{ Params: { id: string } }>("/:id/test-decision", async (req, reply) => {
    const { modelId } = testRequestSchema.parse(req.body);
    const connection = connections.get(req.params.id);
    if (!connection) return notFound(reply);
    if (CONNECTION_KINDS[connection.kind].catalog.decision === "unsupported") return reply.status(400).send({ error: "No decision models here." });
    return runDecisionTest(adapterFor(connection), modelId);
  });

  app.post<{ Params: { id: string } }>("/:id/test-image", async (req, reply) => {
    const { modelId } = testRequestSchema.parse(req.body);
    const connection = connections.get(req.params.id);
    if (!connection) return notFound(reply);
    if (CONNECTION_KINDS[connection.kind].catalog.image === "unsupported") return reply.status(400).send({ error: "No image models here." });
    return runImageTest(adapterFor(connection), modelId);
  });
};

export const assignmentRoutes: FastifyPluginAsync<{ connections: ConnectionsRepo }> = async (app, { connections }) => {
  app.get("/", async () => connections.listAssignments());

  app.put<{ Params: { task: string } }>("/:task", async (req, reply) => {
    const task = taskSchema.parse(req.params.task);
    const { connectionId, modelId } = setAssignmentSchema.parse(req.body);
    const connection = connections.get(connectionId);
    if (!connection) return notFound(reply);
    const capability: Capability = TASK_CAPABILITY[task];
    if (CONNECTION_KINDS[connection.kind].catalog[capability] === "unsupported") {
      return reply.status(400).send({ error: `${CONNECTION_KINDS[connection.kind].label} cannot handle ${capability}.` });
    }
    if (!connections.listModels(connectionId, capability).some((m) => m.modelId === modelId)) {
      return reply.status(400).send({ error: `Fetch or add the ${capability} model on this connection first.` });
    }
    return connections.setAssignment(task, connectionId, modelId);
  });

  app.delete<{ Params: { task: string } }>("/:task", async (req, reply) => {
    const task = taskSchema.parse(req.params.task);
    connections.clearAssignment(task);
    return reply.status(204).send();
  });
};
