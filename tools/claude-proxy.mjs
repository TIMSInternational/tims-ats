#!/usr/bin/env node
/**
 * Local OpenAI-compatible proxy that routes requests through Claude Code CLI.
 * OpenPencil → localhost:4123 → claude -p → response
 */

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = 4123;

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      env: { ...process.env, TERM: "dumb" },
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `claude exited with code ${code}`));
    });

    child.on("error", reject);

    // Send prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === "/v1/models" || req.url === "/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      object: "list",
      data: [{ id: "claude-code", object: "model", owned_by: "anthropic" }],
    }));
  }

  if ((req.url === "/v1/chat/completions" || req.url === "/chat/completions") && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { messages } = JSON.parse(body);

      const prompt = messages
        .map((m) => {
          if (m.role === "system") return `[System instruction]: ${m.content}`;
          if (m.role === "user") return m.content;
          if (m.role === "assistant") return `[Previous assistant response]: ${m.content}`;
          return m.content;
        })
        .join("\n\n");

      console.log(`[proxy] Request (${prompt.length} chars) → claude -p`);

      const responseText = await callClaude(prompt);

      console.log(`[proxy] Response (${responseText.length} chars)`);

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "claude-code",
        choices: [{
          index: 0,
          message: { role: "assistant", content: responseText },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
    } catch (err) {
      console.error(`[proxy] Error:`, err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: err.message, type: "server_error" } }));
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[proxy] Claude Code proxy running on http://localhost:${PORT}/v1`);
  console.log(`[proxy] Connect OpenPencil: URL=http://localhost:${PORT}/v1  Key=sk-anything  Model=claude-code`);
});
