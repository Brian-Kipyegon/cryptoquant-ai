import express from "express";
import axios from "axios";
import { STRATEGY_VERSION, addToAudit, auditStore } from "../stores/audit-store";
import { getZhipuConfig } from "../auth/credentials";

export function registerAiRoutes(app: express.Express) {
  app.post("/api/ai/analyze", async (req, res) => {
    const { prompt, task = "decision" } = req.body;
    const { endpoint, apiKey, model } = getZhipuConfig(task === "summary" ? "summary" : task === "vision" ? "vision" : "decision", req.body);

    if (!endpoint || !apiKey) {
      return res.status(400).json({ error: "Missing Zhipu AI configuration" });
    }

    try {
      const body: any = {
        model,
        messages: [
          {
            role: "system",
            content: task === "summary"
              ? "You are a market summary assistant. Return valid JSON only and keep the output concise and machine-readable."
              : `You are the Core Decision Engine of the CryptoQuant AI Trading Harness.
                 You must output valid JSON only, respect the supplied risk constraints, and cite quantitative evidence.`
          },
          { role: "user", content: prompt }
        ],
      };

      if (String(model).startsWith("glm-")) {
        body.thinking = { type: "enabled" };
      }

      const response = await axios.post(endpoint, body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });
      const content = response.data.choices?.[0]?.message?.content || "";

      let parsed = null;
      if (task !== "summary") {
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        } catch (e) {
          console.warn("Failed to parse AI content as JSON:", e.message);
        }
      }

      // Audit Snapshot
      addToAudit(auditStore.aiSnapshots, {
        input: prompt,
        output: parsed || content,
        rawResponse: { provider: "zhipu", model, response: response.data },
        strategyVersion: STRATEGY_VERSION
      });

      res.json(response.data);
    } catch (error: any) {
      const errorData = error.response?.data || error.message;
      console.error("Zhipu AI Error:", JSON.stringify(errorData));
      res.status(500).json({ error: errorData });
    }
  });
}
