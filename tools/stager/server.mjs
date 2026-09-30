// Stager: local server for the virtual staging layout tool.
// Serves ./public and proxies render requests to the Gemini API (Nano Banana Pro)
// so the API key stays on the server. Node 18+, no dependencies.
//
//   GEMINI_API_KEY=... node server.mjs        # then open http://localhost:5173

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 5173);
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const DEFAULT_MODEL = process.env.STAGER_MODEL || "gemini-3-pro-image-preview";
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 60 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Split a data URL into the { mime_type, data } shape Gemini expects.
function inlinePart(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!m) throw new Error("Expected a base64 data URL");
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

async function handleRender(req, res) {
  if (!API_KEY) {
    return sendJson(res, 400, {
      error: "GEMINI_API_KEY is not set on the server. Use Export for Higgsfield instead, or restart with the key.",
    });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { error: `Bad request: ${e.message}` });
  }
  const { prompt, photo, guide, references = [], aspectRatio, imageSize = "2K", model } = body;
  if (!prompt || !photo || !guide) return sendJson(res, 400, { error: "prompt, photo and guide are required" });

  // Order matters: the prompt refers to "image 1" (photo) and "image 2" (guide).
  const parts = [{ text: prompt }, inlinePart(photo), inlinePart(guide)];
  for (const ref of references) parts.push(inlinePart(ref));

  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { ...(aspectRatio ? { aspectRatio } : {}), imageSize },
    },
  };

  const url = `${API_BASE}/v1beta/models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(payload),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return sendJson(res, r.status, { error: json.error?.message || `Gemini returned ${r.status}` });

    const outParts = json.candidates?.[0]?.content?.parts || [];
    const images = [];
    let text = "";
    for (const p of outParts) {
      const inline = p.inlineData || p.inline_data;
      if (inline?.data) images.push(`data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}`);
      else if (p.text && !p.thought) text += p.text;
    }
    if (!images.length) {
      const reason = json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || "no image returned";
      return sendJson(res, 502, { error: `Model did not return an image (${reason}). ${text}`.trim() });
    }
    sendJson(res, 200, { images, text });
  } catch (e) {
    sendJson(res, 502, { error: `Could not reach Gemini: ${e.message}` });
  }
}

async function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(PUBLIC_DIR, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/config") {
      return sendJson(res, 200, { hasKey: Boolean(API_KEY), model: DEFAULT_MODEL });
    }
    if (req.method === "POST" && req.url === "/api/render") return handleRender(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405);
    res.end();
  })
  .listen(PORT, () => {
    console.log(`Stager running at http://localhost:${PORT}`);
    console.log(API_KEY ? `Rendering with ${DEFAULT_MODEL}` : "No GEMINI_API_KEY set: layout and export work, Render is disabled.");
  });
