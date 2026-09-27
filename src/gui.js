#!/usr/bin/env node
// QVAC Paragraph Shortener — GUI mode.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel, unloadModel, LLAMA_3_2_1B_INST_Q4_0 } from "@qvac/sdk";
import { shorten } from "./logic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 31001;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function serveStatic(res) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// Cap the request body so an accidental multi-megabyte paste (or a bad actor)
// can't make the server buffer an unbounded amount of memory before logic.js
// gets a chance to truncate the text down to its 6000-character prompt window.
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB, far more than any pasted paragraph needs

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

async function main() {
  console.log("▸ Loading language model on-device...");
  const modelId = await loadModel({ modelSrc: LLAMA_3_2_1B_INST_Q4_0 });
  console.log("▸ Model ready.");

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") return serveStatic(res);

    if (req.method === "POST" && req.url === "/api/shorten") {
      try {
        const { text } = await readBody(req);
        if (!text || !text.trim()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Please paste some text first" }));
          return;
        }
        const result = await shorten(modelId, text.trim());
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (error) {
        const status = error.message === "Request body too large" ? 413 : 500;
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.listen(PORT, () => {
    console.log(`▸ QVAC Paragraph Shortener GUI ready at http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    console.log("\n▸ Shutting down...");
    server.close();
    await unloadModel({ modelId });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("✖", error);
  process.exit(1);
});
