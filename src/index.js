/**
 * claud.i — Personal AI assistant powered by Claude Code
 *
 * Always-on Telegram bot that routes messages to Claude Code sessions
 * with per-chat context isolation, cron scheduling, webhook support,
 * skill system, streaming responses, intent auto-routing, and handoff.
 */

import config, { validateConfig } from "./config.js";
import { SessionManager } from "./sessions/session-manager.js";
import { HandoffManager } from "./sessions/handoff.js";
import { Router } from "./router/router.js";
import { TelegramBot } from "./telegram/bot.js";
import { CronScheduler } from "./cron/scheduler.js";
import { WebhookServer } from "./webhook/server.js";
import { SkillLoader } from "./skills/skill-loader.js";
import { AgentLoader } from "./agents/agent-loader.js";

console.log(`
   _____ _                 _   _
  / ____| |               | | (_)
 | |    | | __ _ _   _  __| |  _
 | |    | |/ _\` | | | |/ _\` | | |
 | |____| | (_| | |_| | (_| |_| |
  \\_____|_|\\__,_|\\__,_|\\__,_(_)_|

  ${config.identity.emoji} ${config.identity.name} — Personal AI Assistant v${process.env.npm_package_version || "0.1.0"}
`);

validateConfig();

// Initialize core
const sessionManager = new SessionManager();
const skillLoader = new SkillLoader(config.skills.dir);
const agentLoader = new AgentLoader(config.agents.dir);
const handoff = new HandoffManager(config.handoff.file);

// Initialize telegram bot (need reference for sendToChat)
let bot;

// Initialize cron
const cronScheduler = new CronScheduler(
  sessionManager,
  (chatId, text) => bot.sendToChat(chatId, text),
  config.sessions.dir
);

// Initialize webhook
let webhookServer = null;
if (config.webhook.enabled) {
  webhookServer = new WebhookServer(
    sessionManager,
    (chatId, text) => bot.sendToChat(chatId, text),
    config.sessions.dir,
    config.webhook.port
  );
}

// Initialize router with all components (including handoff and intent router)
const router = new Router(sessionManager, {
  cronScheduler,
  webhookServer,
  skillLoader,
  agentLoader,
  handoff,
});

// Initialize bot
bot = new TelegramBot(router);

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[claud.i] Received ${signal}. Shutting down...`);
  bot.stop();
  cronScheduler.stop();
  if (webhookServer) webhookServer.stop();
  sessionManager.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Start everything
async function start() {
  await bot.start();
  cronScheduler.start();
  if (webhookServer) webhookServer.start();

  const handoffData = handoff.get();
  const handoffStatus = handoffData.lastUpdate
    ? `last: ${handoffData.lastUpdate}`
    : "fresh";

  console.log("\n[claud.i] All systems running.");
  console.log(`  Identity: ${config.identity.emoji} ${config.identity.name}`);
  console.log(`  Telegram: ready`);
  console.log(`  Cron:     ${cronScheduler.listJobs().length} jobs`);
  console.log(
    `  Webhook:  ${webhookServer ? `port ${config.webhook.port}` : "disabled"}`
  );
  console.log(`  Skills:   ${skillLoader.list().length} loaded`);
  console.log(`  Agents:   ${agentLoader.list().length} available`);
  console.log(`  Handoff:  ${handoffStatus}`);
  console.log(`  Intent:   auto-routing enabled`);
}

start().catch((err) => {
  console.error("[claud.i] Failed to start:", err.message);
  sessionManager.shutdown();
  process.exit(1);
});
