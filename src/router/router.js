/**
 * Message Router
 *
 * Routes incoming Telegram messages to the appropriate context.
 * Supports commands for session management.
 *
 * Commands:
 *   /start         - Welcome message
 *   /reset          - Reset current session (clear context)
 *   /sessions       - List active sessions
 *   /project <path> - Set working directory for this chat
 *   /help           - Show available commands
 */

const COMMANDS = {
  "/start": "welcome",
  "/reset": "reset",
  "/sessions": "sessions",
  "/project": "project",
  "/help": "help",
};

export class Router {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    /** @type {Map<string, string>} chatId → workdir override */
    this.workdirMap = new Map();
  }

  /**
   * Route a message. Returns { type, response } or null for passthrough to Claude.
   */
  async route(chatId, text) {
    const trimmed = text.trim();
    const [cmd, ...args] = trimmed.split(/\s+/);
    const command = COMMANDS[cmd?.toLowerCase()];

    if (command) {
      return this._handleCommand(chatId, command, args);
    }

    // Regular message → send to Claude
    return this._sendToClaude(chatId, trimmed);
  }

  async _handleCommand(chatId, command, args) {
    const contextKey = `telegram:${chatId}`;

    switch (command) {
      case "welcome":
        return {
          type: "command",
          response: [
            "🤖 *claud.i* — Your personal Claude Code assistant",
            "",
            "Send any message and I'll process it through Claude Code.",
            "",
            "Commands:",
            "/project <path> — Set working directory",
            "/reset — Reset conversation",
            "/sessions — List active sessions",
            "/help — Show this help",
          ].join("\n"),
        };

      case "reset":
        this.sessionManager.resetSession(contextKey);
        return {
          type: "command",
          response: "Session reset. Starting fresh.",
        };

      case "sessions": {
        const sessions = this.sessionManager.listSessions();
        if (sessions.length === 0) {
          return { type: "command", response: "No active sessions." };
        }
        const lines = sessions.map(
          (s) =>
            `• \`${s.key}\` — ${s.alive ? "running" : "idle"} — last: ${s.lastActivity}`
        );
        return {
          type: "command",
          response: `*Active Sessions (${sessions.length})*\n${lines.join("\n")}`,
        };
      }

      case "project": {
        const path = args.join(" ");
        if (!path) {
          const current = this.workdirMap.get(chatId) || "(default)";
          return {
            type: "command",
            response: `Current project directory: \`${current}\`\n\nUsage: /project /path/to/project`,
          };
        }
        this.workdirMap.set(chatId, path);
        // Reset session so new workdir takes effect
        this.sessionManager.resetSession(contextKey);
        return {
          type: "command",
          response: `Project directory set to \`${path}\`. Session reset.`,
        };
      }

      case "help":
        return this._handleCommand(chatId, "welcome", []);

      default:
        return null;
    }
  }

  async _sendToClaude(chatId, message) {
    const contextKey = `telegram:${chatId}`;
    const workdir = this.workdirMap.get(chatId) || undefined;

    try {
      const response = await this.sessionManager.sendMessage(
        contextKey,
        message,
        workdir
      );
      return { type: "claude", response };
    } catch (err) {
      console.error(`[Router] Error for ${contextKey}:`, err.message);
      return {
        type: "error",
        response: `Error: ${err.message}`,
      };
    }
  }
}
