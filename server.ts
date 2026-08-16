import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

// Import custom agents, policies, schema, and storage modules
import { getStore, addAuditLog } from "./server/store";
import { getAgent, agents } from "./server/agents";
import { evaluatePolicy } from "./server/policies";
import { runGeminiAgent } from "./server/gemini";
import { agentRunRequestSchema } from "./server/schemas";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini Client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please configure it in Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Helper to authenticate the founder if FOUNDER_API_KEY is configured
function verifyFounderSignature(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expectedKey = process.env.FOUNDER_API_KEY;
  // If not configured, bypass gracefully for preview safety, otherwise enforce
  if (expectedKey) {
    const receivedKey = req.headers["x-founder-key"] || req.headers["authorization"];
    if (!receivedKey || receivedKey !== expectedKey) {
      res.status(401).json({ ok: false, error: "Unauthorized founder signature verification." });
      return;
    }
  }
  next();
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    ok: true,
    service: "Tasami OS API",
    version: "2026.1.0",
    timestamp: new Date().toISOString()
  });
});

// Chat API endpoint supporting specific roles and High Thinking Mode
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, systemInstruction, thinkingMode } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Invalid 'messages' format. Expected an array of messages." });
      return;
    }

    const ai = getGeminiClient();

    // Map client messages to Gemini contents structure
    const formattedContents = messages.map((msg: any) => {
      const role = msg.role === "assistant" ? "model" : "user";
      return {
        role,
        parts: [{ text: msg.content || "" }],
      };
    });

    const model = thinkingMode ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";

    const config: any = {
      systemInstruction: systemInstruction || "You are an AI assistant in the Tasami OS network.",
    };

    if (thinkingMode) {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.HIGH,
      };
    }

    const response = await ai.models.generateContent({
      model,
      contents: formattedContents,
      config,
    });

    const replyText = response.text || "";

    res.json({
      role: "assistant",
      content: replyText,
      modelUsed: model,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Gemini API Error in /api/chat:", error);
    res.status(500).json({
      error: error.message || "An internal error occurred while communicating with Gemini.",
    });
  }
});

// GET /api/agents - lists active workforce agents
app.get("/api/agents", verifyFounderSignature, (req, res) => {
  res.json({ ok: true, agents });
});

// GET /api/override - gets current emergency manual override status
app.get("/api/override", verifyFounderSignature, (req, res) => {
  const store = getStore();
  res.json({ ok: true, manualOverride: store.manualOverride });
});

// PATCH /api/override - updates current manual override status
app.patch("/api/override", verifyFounderSignature, (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ ok: false, error: "enabled field must be a boolean." });
    return;
  }
  const store = getStore();
  store.manualOverride = enabled;

  addAuditLog("override_updated", "Manual override state changed by the founder.", {
    manualOverride: store.manualOverride
  });

  res.json({ ok: true, manualOverride: store.manualOverride });
});

// GET /api/approvals - lists active and pending founder approvals
app.get("/api/approvals", verifyFounderSignature, (req, res) => {
  const store = getStore();
  res.json({ ok: true, approvals: store.approvals });
});

// POST /api/approvals/:id/action - processes approval or rejection of an agency decision
app.post("/api/approvals/:id/action", verifyFounderSignature, (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // "approved" or "rejected"

  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({ ok: false, error: "Invalid status. Must be 'approved' or 'rejected'." });
    return;
  }

  const store = getStore();
  const index = store.approvals.findIndex((app) => app.id === id);

  if (index === -1) {
    res.status(404).json({ ok: false, error: "Requested approval item was not found." });
    return;
  }

  const item = store.approvals[index];
  item.status = status;

  // Remove from current active lists
  store.approvals.splice(index, 1);

  addAuditLog("approval_updated", `Sovereignty Action: Approval item ${id} was ${status} by founder.`, item);

  res.json({ ok: true, id, status, approvals: store.approvals });
});

// POST /api/agents/run - Evaluates policy, triggers LLM agent, generates audit log, and manages approvals
app.post("/api/agents/run", verifyFounderSignature, async (req, res) => {
  try {
    const validated = agentRunRequestSchema.safeParse(req.body);
    if (!validated.success) {
      res.status(400).json({ ok: false, error: validated.error.message });
      return;
    }

    const input = validated.data;
    const store = getStore();
    const policy = evaluatePolicy(input, store.manualOverride);

    if (policy.blocked) {
      addAuditLog("policy_blocked", policy.reason, {
        input,
        policy
      });

      res.status(403).json({
        ok: false,
        status: "blocked",
        reason: policy.reason
      });
      return;
    }

    const decision = await runGeminiAgent(input, policy);

    addAuditLog("agent_run", `Agent run complete for ${input.agentId}.`, {
      input,
      policy,
      decision
    });

    if (decision.requiresHumanApproval) {
      const approval = {
        id: `app-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        createdAt: new Date().toISOString(),
        agentId: input.agentId,
        objective: input.objective,
        amountUsd: input.amountUsd,
        status: "pending" as const,
        decision
      };

      store.approvals.unshift(approval);

      addAuditLog("approval_created", "Founder approval required for agent execution.", approval);

      res.status(202).json({
        ok: true,
        status: "approval_required",
        policy,
        approval
      });
      return;
    }

    res.json({
      ok: true,
      status: "autonomous_decision_ready",
      executionMode: "dry_run",
      note: "MVP safety: no external financial/support/marketing tool was executed yet.",
      policy,
      decision
    });

  } catch (error: any) {
    console.error("Agent Execution Framework Error:", error);
    res.status(500).json({ ok: false, error: error.message || "Internal server error during agent execution." });
  }
});

// Start server and handle Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Tasami OS backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
