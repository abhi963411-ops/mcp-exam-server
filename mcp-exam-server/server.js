const http = require("node:http");
const crypto = require("node:crypto");

const EMAIL = "22f3003081@ds.study.iitm.ac.in";
const TOOL_NAME = "solve_challenge";
const PORT = Number(process.env.PORT || 3000);
const ENDPOINT = "/mcp";

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function answerForChallenge(challenge) {
  const normalizedEmail = EMAIL.trim().toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`${challenge}:${normalizedEmail}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;
  const maxBytes = 1024 * 1024;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url !== ENDPOINT) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found. MCP endpoint is /mcp.");
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "POST",
    });
    res.end("Use POST for MCP JSON-RPC requests.");
    return;
  }

  let message;
  try {
    message = await readJsonBody(req);
  } catch (error) {
    res.writeHead(error.statusCode || 400, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(error.message || "Bad request");
    return;
  }

  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  ) {
    sendJson(res, 200, rpcError(message?.id, -32600, "Invalid Request"));
    return;
  }

  // Notifications have no id and must not receive a JSON-RPC response.
  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    res.writeHead(202);
    res.end();
    return;
  }

  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    const supportedVersions = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);
    const protocolVersion = supportedVersions.has(requestedVersion)
      ? requestedVersion
      : "2025-03-26";
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "exam-challenge-mcp-server", version: "1.0.0" },
      },
    });
    return;
  }

  if (message.method === "ping") {
    sendJson(res, 200, { jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }

  if (message.method === "tools/list") {
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: TOOL_NAME,
          description: "Returns the required SHA-256 challenge response for this HTTP request.",
          inputSchema: { type: "object", properties: {} },
        }],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    if (message.params?.name !== TOOL_NAME) {
      sendJson(res, 200, rpcError(message.id, -32602, "Unknown tool"));
      return;
    }
    // Read the challenge from this HTTP request's headers, never from JSON arguments.
    const challenge = req.headers["x-exam-challenge"];
    if (typeof challenge !== "string" || !/^[0-9a-f]{32}$/.test(challenge)) {
      sendJson(res, 200, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "Missing or invalid X-Exam-Challenge header" }],
          isError: true,
        },
      });
      return;
    }
    const answer = answerForChallenge(challenge);
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: answer }] },
    });
    return;
  }

  sendJson(res, 200, rpcError(message.id, -32601, "Method not found"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MCP server listening on port ${PORT}`);
  console.log(`MCP endpoint path: ${ENDPOINT}`);
});
server.on("error", (error) => {
  console.error("Server error:", error);
  process.exitCode = 1;
});
