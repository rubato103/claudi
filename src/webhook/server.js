/**
 * Webhook Server
 *
 * HTTP server that receives webhooks from external systems (CI/CD, monitoring, etc.)
 * and forwards them to Claude Code for processing, then sends results to Telegram.
 *
 * Endpoints:
 *   POST /webhook/:id   — Receive a webhook, process with Claude, notify Telegram
 *   GET  /health        — Health check
 */

import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

export class WebhookServer {
  constructor(sessionManager, sendFn, dataDir, port = 3000) {
    this.sessionManager = sessionManager;
    this.sendToChat = sendFn;
    this.port = port;
    this.filePath = resolve(dataDir, "webhooks.json");
    this.hooks = [];
    this._load();
    this.server = null;
  }

  _load() {
    try {
      if (existsSync(this.filePath)) {
        this.hooks = JSON.parse(readFileSync(this.filePath, "utf-8"));
      }
    } catch {
      this.hooks = [];
    }
  }

  _save() {
    try {
      mkdirSync(resolve(this.filePath, ".."), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify(this.hooks, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("[Webhook] Failed to save:", err.message);
    }
  }

  /**
   * Register a new webhook.
   * @returns {object} The created webhook with its URL path
   */
  addHook(chatId, name, promptTemplate) {
    const id = `wh_${Date.now().toString(36)}`;
    const hook = {
      id,
      chatId,
      name,
      promptTemplate,
      createdAt: new Date().toISOString(),
    };
    this.hooks.push(hook);
    this._save();
    console.log(`[Webhook] Registered: ${name} → /webhook/${id}`);
    return hook;
  }

  removeHook(hookId) {
    const idx = this.hooks.findIndex((h) => h.id === hookId);
    if (idx === -1) return false;
    this.hooks.splice(idx, 1);
    this._save();
    return true;
  }

  listHooks(chatId = null) {
    if (chatId) return this.hooks.filter((h) => h.chatId === chatId);
    return this.hooks;
  }

  start() {
    this.server = createServer(async (req, res) => {
      // Health check
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", webhooks: this.hooks.length }));
        return;
      }

      // Webhook endpoint
      const match = req.url?.match(/^\/webhook\/(\w+)/);
      if (req.method === "POST" && match) {
        const hookId = match[1];
        const hook = this.hooks.find((h) => h.id === hookId);

        if (!hook) {
          res.writeHead(404);
          res.end("Webhook not found");
          return;
        }

        // Read body
        let body = "";
        for await (const chunk of req) body += chunk;

        // Acknowledge immediately
        res.writeHead(200);
        res.end("OK");

        // Process async
        this._processWebhook(hook, body).catch((err) =>
          console.error(`[Webhook] Error processing ${hook.name}:`, err.message)
        );
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    this.server.listen(this.port, () => {
      console.log(`[Webhook] Server listening on port ${this.port}`);
    });
  }

  async _processWebhook(hook, body) {
    console.log(`[Webhook] Received: ${hook.name}`);

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = body;
    }

    const prompt = hook.promptTemplate
      ? hook.promptTemplate.replace(
          "{{payload}}",
          typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
        )
      : `Webhook "${hook.name}" received the following payload. Analyze it and provide a summary:\n\n${typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)}`;

    try {
      const contextKey = `webhook:${hook.id}`;
      const response = await this.sessionManager.sendMessage(contextKey, prompt);
      await this.sendToChat(
        hook.chatId,
        `🔔 *[${hook.name}]*\n\n${response}`
      );
    } catch (err) {
      await this.sendToChat(
        hook.chatId,
        `🔔 *[${hook.name}]* — Error: ${err.message}`
      );
    }
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log("[Webhook] Server stopped.");
    }
  }
}
