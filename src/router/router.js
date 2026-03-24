/**
 * Message Router
 *
 * Routes incoming Telegram messages to the appropriate handler.
 * Supports commands for session, cron, webhook, and skill management.
 *
 * Commands:
 *   /start              - Welcome message
 *   /reset              - Reset current session
 *   /sessions           - List active sessions
 *   /project <path>     - Set working directory
 *   /cron <schedule> <prompt> - Add a cron job
 *   /crons              - List cron jobs
 *   /uncron <id>        - Remove a cron job
 *   /webhook <name> [template] - Register a webhook
 *   /webhooks           - List webhooks
 *   /unwebook <id>      - Remove a webhook
 *   /skills             - List loaded skills
 *   /help               - Show all commands
 */

export class Router {
  constructor(sessionManager, opts = {}) {
    this.sessionManager = sessionManager;
    this.cronScheduler = opts.cronScheduler || null;
    this.webhookServer = opts.webhookServer || null;
    this.skillLoader = opts.skillLoader || null;
    /** @type {Map<string, string>} chatId → workdir override */
    this.workdirMap = new Map();
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

    // Command routing
    const commands = {
      "/start": () => this._cmdHelp(),
      "/help": () => this._cmdHelp(),
      "/reset": () => this._cmdReset(chatId),
      "/sessions": () => this._cmdSessions(),
      "/project": () => this._cmdProject(chatId, args),
      "/cron": () => this._cmdCronAdd(chatId, args, trimmed),
      "/crons": () => this._cmdCronList(chatId),
      "/uncron": () => this._cmdCronRemove(args),
      "/webhook": () => this._cmdWebhookAdd(chatId, args, trimmed),
      "/webhooks": () => this._cmdWebhookList(chatId),
      "/unwebhook": () => this._cmdWebhookRemove(args),
      "/skills": () => this._cmdSkills(),
    };

    if (commands[cmdLower]) {
      const response = await commands[cmdLower]();
      return { type: "command", response };
    }

    // Regular message → Claude
    return this._sendToClaude(chatId, trimmed, opts);
  }

  // ── Commands ──

  _cmdHelp() {
    return [
      "🤖 *claud.i* — Personal Claude Code Assistant\n",
      "*Session*",
      "  /project <path> — Set working directory",
      "  /reset — Reset conversation",
      "  /sessions — List active sessions\n",
      "*Cron*",
      "  /cron <schedule> <prompt> — Add scheduled task",
      '  Example: `/cron 0 9 * * * Daily news summary`',
      "  /crons — List scheduled tasks",
      "  /uncron <id> — Remove task\n",
      "*Webhook*",
      "  /webhook <name> [template] — Register webhook",
      "  /webhooks — List webhooks",
      "  /unwebhook <id> — Remove webhook\n",
      "*Skills*",
      "  /skills — List loaded skills\n",
      "Send any text message to chat with Claude.",
      "Send photos, files, or voice messages — they'll be processed too.",
    ].join("\n");
  }

  _cmdReset(chatId) {
    this.sessionManager.resetSession(`telegram:${chatId}`);
    return "Session reset. Starting fresh.";
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

  _cmdCronAdd(chatId, args, raw) {
    if (!this.cronScheduler) return "Cron scheduler not available.";
    // Parse: /cron <5 cron fields> <prompt>
    // Example: /cron 0 9 * * * Daily news summary
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

  _cmdWebhookAdd(chatId, args, raw) {
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

    // Prepend skill context if available
    let prompt = message;
    if (this.skillLoader) {
      const skillCtx = this.skillLoader.buildSkillContext(message);
      if (skillCtx) prompt = skillCtx + message;
    }

    try {
      const response = await this.sessionManager.sendMessage(
        contextKey,
        prompt,
        workdir,
        { onChunk: opts.onChunk, files: opts.files }
      );
      return { type: "claude", response };
    } catch (err) {
      console.error(`[Router] Error for ${contextKey}:`, err.message);
      return { type: "error", response: `Error: ${err.message}` };
    }
  }
}
