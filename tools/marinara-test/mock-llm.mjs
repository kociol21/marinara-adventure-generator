// Mock OpenAI-compatible LLM for integration tests: records every request Marinara sends
// (the final prompt) to a JSONL file and answers with canned text. No network, no cost.
// Usage: node mock-llm.mjs [port] [logFile]
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 7999);
const logFile = process.argv[3] ?? "mock-llm-requests.jsonl";

function reply(body) {
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
