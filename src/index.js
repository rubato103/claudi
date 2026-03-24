/**
 * claud.i — Personal AI assistant powered by Claude Code
 *
 * Always-on Telegram bot that routes messages to Claude Code sessions
 * with per-chat context isolation and session persistence.
 */

import config, { validateConfig } from "./config.js";
import { SessionManager } from "./sessions/session-manager.js";
import { Router } from "./router/router.js";
import { TelegramBot } from "./telegram/bot.js";

console.log(`
   _____ _                 _   _
  / ____| |               | | (_)
 | |    | | __ _ _   _  __| |  _
 | |    | |/ _\` | | | |/ _\` | | |
 | |____| | (_| | |_| | (_| |_| |
  \\_____|_|\\__,_|\\__,_|\\__,_(_)_|

  Personal AI Assistant — v${process.env.npm_package_version || "0.1.0"}
`);

// Validate configuration
validateConfig();

// Initialize components
const sessionManager = new SessionManager();
const router = new Router(sessionManager);
const bot = new TelegramBot(router);

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[claud.i] Received ${signal}. Shutting down...`);
  bot.stop();
  sessionManager.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Start
bot.start().catch((err) => {
  console.error("[claud.i] Failed to start:", err.message);
  sessionManager.shutdown();
  process.exit(1);
});
