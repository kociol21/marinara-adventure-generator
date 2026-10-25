// Mock OpenAI-compatible LLM for integration tests: records every request Marinara sends
// (the final prompt) to a JSONL file and answers with canned text. No network, no cost.
// Usage: node mock-llm.mjs [port] [logFile]
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 7999);
const logFile = process.argv[3] ?? "mock-llm-requests.jsonl";

/** Scripted requirements interview: partial answer with questions first, complete answer after. */
function interviewReply(messages) {
  const userTurns = messages.filter((m) => m.role === "user").length;
  const base = {
    genre: "noir detective mystery",
    subgenres: ["urban fantasy"],
    tone: ["gritty", "melancholic"],
    narration: { pov: "second", tense: "present", style: "hard-boiled first impressions" },
    setting: { era: "alternate 1940", place: "New York City", technology: "1940s", supernatural: "fantasy races and everyday magic", notes: "" },
    startingSituation: "",
    protagonist: { mode: "new", notes: "a small-time private investigator" },
    maxNpcCards: 4,
  };
  if (userTurns <= 1) {
    return JSON.stringify({
      message: "A noir case in a magical 1940 New York — great start. A few quick choices:",
      questions: ["Where does the first scene happen — your office, or somewhere else?", "Who is the real killer?", "Any topics you never want to see?"],
      requirements: base,
      assumptions: ["Length: medium (a few sessions)"],
      readyForSummary: false,
    });
  }
  return JSON.stringify({
    message: "Thanks, I have everything I need. Please review the summary.",
    questions: [],
    requirements: {
      ...base,
      startingSituation: "Late evening in the investigator's cramped office when a woman in a red dress walks in.",
      content: { violence: "moderate", romance: "background", sexualContent: "fade-to-black", horror: "light", hardLimits: ["harm to children"] },
      visualStyle: "painted 1940s pulp illustration",
    },
    assumptions: ["Length: medium (a few sessions)", "Narration: second person, present tense"],
    readyForSummary: true,
  });
}

function reply(body) {
  const system = (body.messages ?? []).find((m) => m.role === "system")?.content ?? "";
  if (system.includes("You interview a player")) return interviewReply(body.messages);
  const text = JSON.stringify(body.messages ?? body.input ?? "");
  if (text.includes("overarchingArc")) {
    return JSON.stringify({
      overarchingArc: { description: "MOCK_ARC_UPDATE", protagonistArc: "MOCK", completed: false },
    });
  }
  return "MOCK_REPLY";
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "probe-model", object: "model" }] }));
    }
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {}
    appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), url: req.url, body }) + "\n");
    if (req.url?.endsWith("/images/generations")) {
      // 1x1 red PNG.
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ created: 0, data: [{ b64_json: png }] }));
    }
    if (req.url?.endsWith("/embeddings")) {
      // Deterministic 16-dim bag-of-characters vectors: similar text -> similar vector.
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
      const data = inputs.map((text, index) => {
        const v = new Array(16).fill(0);
        for (const ch of String(text).toLowerCase()) v[ch.charCodeAt(0) % 16] += 1;
        const norm = Math.hypot(...v) || 1;
        return { object: "embedding", index, embedding: v.map((x) => x / norm) };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data, model: body.model, usage: { prompt_tokens: 0, total_tokens: 0 } }));
    }
    const content = reply(body);
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = { id: "mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content } }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "mock",
        object: "chat.completion",
        model: body.model ?? "probe-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    );
  });
}).listen(port, "127.0.0.1", () => console.log(`mock LLM on http://127.0.0.1:${port}/v1, logging to ${logFile}`));
