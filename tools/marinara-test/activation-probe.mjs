// Activation probe: checks that a tag-filtered lorebook entry fires only in chats whose
// characters carry the tag, and that Secret Plot memory can be seeded through the API.
// Usage: node activation-probe.mjs <lorebookId> <alphaCharId> <betaCharId> [baseUrl]
const [lorebookId, alphaId, betaId, base = "http://127.0.0.1:7870"] = process.argv.slice(2);
const headers = { "Content-Type": "application/json", "x-marinara-csrf": "1" };

async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function chatWith(name, characterIds) {
  const chat = await api("POST", "/api/chats", { name, mode: "roleplay", characterIds });
  await api("POST", `/api/chats/${chat.id}/messages`, {
    chatId: chat.id,
    role: "user",
    characterId: null,
    content: "We walk toward the lighthouse.",
  });
  return chat;
}

const alphaChat = await chatWith("Probe chat Alpha", [alphaId]);
const betaChat = await chatWith("Probe chat Beta", [betaId]);

for (const [label, chat] of [["alpha", alphaChat], ["beta", betaChat]]) {
  const result = await api("POST", `/api/lorebooks/${lorebookId}/test`, { chatId: chat.id });
  const names = (result.entries ?? result.matches ?? result.activated ?? []).map((e) => e.name ?? e.entryName);
  console.log(`${label} chat activates:`, names, Object.keys(result));
}

const patched = await api("PATCH", `/api/agents/memory/director/${alphaChat.id}`, {
  patch: {
    overarchingArc: { description: "PROBE_ARC", protagonistArc: "PROBE_PROTAGONIST", completed: false },
    pacing: "slow",
  },
});
console.log("director memory after seed:", JSON.stringify(patched.memory));
console.log("chat metadata keys:", Object.keys(alphaChat.metadata ?? {}).slice(0, 40));
