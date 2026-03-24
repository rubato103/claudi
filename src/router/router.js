/**
 * Message Router
 *
 * Routes incoming Telegram messages to the appropriate handler.
 * Supports commands for session, agent, cron, webhook, skill management,
 * auto-routing via intent detection, handoff context injection, and briefings.
 */

import { detectIntent } from "./intent-router.js";
import { HandoffManager } from "../sessions/handoff.js";
import { runBriefing } from "../workflows/briefing.js";
import config from "../config.js";

export class Router {
  constructor(sessionManager, opts = {}) {
    this.sessionManager = sessionManager;
    this.cronScheduler = opts.cronScheduler || null;
    this.webhookServer = opts.webhookServer || null;
    this.skillLoader = opts.skillLoader || null;
    this.agentLoader = opts.agentLoader || null;
    this.handoff = opts.handoff || null;
    /** @type {Map<string, string>} chatId → workdir override */
    this.workdirMap = new Map();
    /** @type {Map<string, string>} chatId → agent name */
    this.agentMap = new Map();
  }

  /**
   * Route a message.
   * @param {string} chatId
   * @param {string} text
   * @param {object} [opts] - { files, onChunk }
   */
  async route(chatId, text, opts = {}) {
    const trimmed = text.trim();
    const [cmd, ...args] = trimmed.split(/\s+/);
    const cmdLower = cmd?.toLowerCase();

    const commands = {
      "/start": () => this._cmdHelp(),
      "/help": () => this._cmdHelp(),
      "/reset": () => this._cmdReset(chatId),
      "/sessions": () => this._cmdSessions(),
      "/project": () => this._cmdProject(chatId, args),
      "/agent": () => this._cmdAgent(chatId, args),
      "/agents": () => this._cmdAgentList(),
      "/cron": () => this._cmdCronAdd(chatId, args),
      "/crons": () => this._cmdCronList(chatId),
      "/uncron": () => this._cmdCronRemove(args),
      "/webhook": () => this._cmdWebhookAdd(chatId, args),
      "/webhooks": () => this._cmdWebhookList(chatId),
      "/unwebhook": () => this._cmdWebhookRemove(args),
      "/skills": () => this._cmdSkills(),
      "/briefing": () => this._cmdBriefing(chatId, args, opts),
    };

    if (commands[cmdLower]) {
      const response = await commands[cmdLower]();
      return { type: "command", response };
    }

    return this._sendToClaude(chatId, trimmed, opts);
  }

  // ── Help ──

  _cmdHelp() {
    return [
      "🦾 *Jarvis* — Personal AI Assistant\n",
      "*Session*",
      "  /project <path> — Set working directory",
      "  /reset — Reset conversation",
      "  /sessions — List active sessions\n",
      "*Agent*",
      "  /agents — List available agents",
      "  /agent <name> — Switch agent role",
      "  /agent off — Return to default mode\n",
      "*Briefing*",
      "  /briefing — Generate morning/evening briefing",
      "  /briefing 오전 — Force morning briefing",
      "  /briefing 오후 — Force evening briefing\n",
      "*Cron*",
      "  /cron <schedule> <prompt> — Add scheduled task",
      "  /crons — List tasks",
      "  /uncron <id> — Remove task\n",
      "*Webhook*",
      "  /webhook <name> [template] — Register webhook",
      "  /webhooks — List webhooks",
      "  /unwebhook <id> — Remove webhook\n",
      "*Skills*",
      "  /skills — List loaded skills\n",
      "Send text, photos, files, or voice messages.",
      "Agent auto-routing is active — no need to switch manually.",
    ].join("\n");
  }

  // ── Session ──

  _cmdReset(chatId) {
    this.sessionManager.resetSession(`telegram:${chatId}`);
    this.agentMap.delete(chatId);
    return "Session and agent reset. Starting fresh.";
  }

  _cmdSessions() {
    const sessions = this.sessionManager.listSessions();
    if (sessions.length === 0) return "No active sessions.";
    const lines = sessions.map(
      (s) =>
        `• \`${s.key}\` — ${s.alive ? "running" : "idle"} — ${s.lastActivity}`
    );
    return `*Active Sessions (${sessions.length})*\n${lines.join("\n")}`;
  }

  _cmdProject(chatId, args) {
    const path = args.join(" ");
    if (!path) {
      const current = this.workdirMap.get(chatId) || "(default)";
      return `Current project: \`${current}\`\nUsage: /project /path/to/project`;
    }
    this.workdirMap.set(chatId, path);
    this.sessionManager.resetSession(`telegram:${chatId}`);
    return `Project set to \`${path}\`. Session reset.`;
  }

  // ── Agent ──

  _cmdAgent(chatId, args) {
    if (!this.agentLoader) return "Agent system not available.";

    const subCmd = args[0]?.toLowerCase();

    if (!subCmd) {
      const current = this.agentMap.get(chatId);
      if (current) {
        const agent = this.agentLoader.get(current);
        return `Current agent: ${agent?.icon || "🤖"} *${current}* — ${agent?.description || ""}\n\nUse \`/agent off\` to return to default.`;
      }
      return "No agent selected. Auto-routing is active.\nUse `/agents` to see available agents.";
    }

    if (subCmd === "off" || subCmd === "default" || subCmd === "none") {
      this.agentMap.delete(chatId);
      this.sessionManager.resetSession(`telegram:${chatId}`);
      return "Agent deactivated. Back to auto-routing mode. Session reset.";
    }

    const agent = this.agentLoader.get(subCmd);
    if (!agent) {
      const available = this.agentLoader
        .list()
        .map((a) => a.name)
        .join(", ");
      return `Agent \`${subCmd}\` not found.\nAvailable: ${available}`;
    }

    const previousAgent = this.agentMap.get(chatId);
    this.agentMap.set(chatId, agent.name);

    // Reset session when switching agents to avoid context bleed
    if (previousAgent !== agent.name) {
      this.sessionManager.resetSession(`telegram:${chatId}`);
    }

    return `${agent.icon} Agent switched to *${agent.name}*\n${agent.description}\n\nSession reset for clean context.`;
  }

  _cmdAgentList() {
    if (!this.agentLoader) return "Agent system not available.";
    const agents = this.agentLoader.list();
    if (agents.length === 0) return "No agents available.";
    const lines = agents.map(
      (a) => `${a.icon} *${a.name}* — ${a.description}`
    );
    return [
      `*Available Agents (${agents.length})*\n`,
      ...lines,
      "\nUse `/agent <name>` to activate.",
      "Auto-routing is also active for automatic agent selection.",
    ].join("\n");
  }

  // ── Briefing ──

  async _cmdBriefing(chatId, args, opts = {}) {
    const periodArg = args[0];
    const briefingOpts = {};

    if (periodArg === "오전" || periodArg === "morning") {
      briefingOpts.period = "오전";
    } else if (periodArg === "오후" || periodArg === "evening") {
      briefingOpts.period = "오후";
    }

    try {
      const result = await runBriefing(this.sessionManager, {
        ...briefingOpts,
        onChunk: opts.onChunk,
      });

      // Update handoff with briefing context
      if (this.handoff) {
        this.handoff.update({
          agent: "analyst",
          topic: `브리핑 생성 (${briefingOpts.period || "auto"})`,
          keyContext: ["briefing generated"],
        });
      }

      // Return the short version for Telegram
      return result.short || result.raw;
    } catch (err) {
      console.error("[Router] Briefing error:", err.message);
      return `브리핑 생성 중 오류가 발생했습니다: ${err.message}`;
    }
  }

  // ── Cron ──

  _cmdCronAdd(chatId, args) {
    if (!this.cronScheduler) return "Cron scheduler not available.";
    if (args.length < 6) {
      return "Usage: `/cron <min> <hour> <day> <month> <weekday> <prompt>`\nExample: `/cron 0 9 * * * Summarize today's news`";
    }
    const schedule = args.slice(0, 5).join(" ");
    const prompt = args.slice(5).join(" ");
    const job = this.cronScheduler.addJob(chatId, schedule, prompt);
    return `Cron job added:\n• ID: \`${job.id}\`\n• Schedule: \`${schedule}\`\n• Prompt: ${prompt}`;
  }

  _cmdCronList(chatId) {
    if (!this.cronScheduler) return "Cron scheduler not available.";
    const jobs = this.cronScheduler.listJobs(chatId);
    if (jobs.length === 0) return "No scheduled tasks.";
    const lines = jobs.map(
      (j) =>
        `• \`${j.id}\` — \`${j.schedule}\` — ${j.name} ${j.enabled ? "" : "(disabled)"}`
    );
    return `*Scheduled Tasks (${jobs.length})*\n${lines.join("\n")}`;
  }

  _cmdCronRemove(args) {
    if (!this.cronScheduler) return "Cron scheduler not available.";
    const id = args[0];
    if (!id) return "Usage: /uncron <job_id>";
    return this.cronScheduler.removeJob(id)
      ? `Cron job \`${id}\` removed.`
      : `Job \`${id}\` not found.`;
  }

  // ── Webhook ──

  _cmdWebhookAdd(chatId, args) {
    if (!this.webhookServer) return "Webhook server not available.";
    const name = args[0];
    if (!name) {
      return "Usage: `/webhook <name> [prompt template]`\nUse `{{payload}}` in template for webhook data.";
    }
    const template = args.slice(1).join(" ") || null;
    const hook = this.webhookServer.addHook(chatId, name, template);
    return `Webhook registered:\n• ID: \`${hook.id}\`\n• URL: \`POST /webhook/${hook.id}\`\n• Name: ${name}`;
  }

  _cmdWebhookList(chatId) {
    if (!this.webhookServer) return "Webhook server not available.";
    const hooks = this.webhookServer.listHooks(chatId);
    if (hooks.length === 0) return "No webhooks registered.";
    const lines = hooks.map(
      (h) => `• \`${h.id}\` — ${h.name} — \`/webhook/${h.id}\``
    );
    return `*Webhooks (${hooks.length})*\n${lines.join("\n")}`;
  }

  _cmdWebhookRemove(args) {
    if (!this.webhookServer) return "Webhook server not available.";
    const id = args[0];
    if (!id) return "Usage: /unwebhook <webhook_id>";
    return this.webhookServer.removeHook(id)
      ? `Webhook \`${id}\` removed.`
      : `Webhook \`${id}\` not found.`;
  }

  // ── Skills ──

  _cmdSkills() {
    if (!this.skillLoader) return "Skills not available.";
    const skills = this.skillLoader.list();
    if (skills.length === 0) return "No skills loaded.";
    const lines = skills.map(
      (s) =>
        `• *${s.name}* — ${s.description || "(no description)"}${s.trigger ? ` [trigger: ${s.trigger}]` : ""}${s.always ? " (always on)" : ""}`
    );
    return `*Loaded Skills (${skills.length})*\n${lines.join("\n")}`;
  }

  // ── Claude Message ──

  async _sendToClaude(chatId, message, opts = {}) {
    const contextKey = `telegram:${chatId}`;
    const workdir = this.workdirMap.get(chatId) || undefined;

    // Build prompt with handoff + agent + skill context
    let prompt = "";

    // 1. Inject handoff context from previous session
    if (this.handoff) {
      prompt += this.handoff.buildPromptPrefix();
    }

    // 2. Determine agent: manual override > auto-detect > default (jarvis)
    let agentName = this.agentMap.get(chatId);
    let autoRouted = false;

    if (!agentName && this.agentLoader) {
      // Auto-detect intent from agent trigger keywords
      const detectedAgent = detectIntent(this.agentLoader, message);
      if (detectedAgent) {
        agentName = detectedAgent;
        autoRouted = true;
      } else {
        // Fall back to default agent (marked with default: true in frontmatter)
        const defaultName = this.agentLoader.getDefaultName();
        if (defaultName) agentName = defaultName;
      }
    }

    // 3. Agent system prompt
    if (agentName && this.agentLoader) {
      prompt += this.agentLoader.buildPromptPrefix(agentName);
    }

    // 4. Skill context
    if (this.skillLoader) {
      const skillCtx = this.skillLoader.buildSkillContext(message);
      if (skillCtx) prompt += skillCtx;
    }

    prompt += message;

    try {
      const response = await this.sessionManager.sendMessage(
        contextKey,
        prompt,
        workdir,
        { onChunk: opts.onChunk, files: opts.files }
      );

      // Update handoff after successful response
      if (this.handoff) {
        this.handoff.update({
          agent: agentName || "default",
          topic: HandoffManager.extractTopic(message),
          keyContext: [
            `${autoRouted ? "(auto)" : "(manual)"} agent: ${agentName || "default"}`,
          ],
        });
      }

      return { type: "claude", response };
    } catch (err) {
      console.error(`[Router] Error for ${contextKey}:`, err.message);
      return { type: "error", response: `Error: ${err.message}` };
    }
  }
}
