/**
 * Telegram Bot
 *
 * Handles Telegram Bot API via grammY.
 * Implements access control, message queuing, and response delivery.
 */

import { Bot } from "grammy";
import config from "../config.js";

export class TelegramBot {
  constructor(router) {
    this.router = router;
    this.bot = new Bot(config.telegram.token);
    /** @type {Map<string, Promise>} per-chat sequential processing */
    this.chatQueues = new Map();

    this._setup();
  }

  _setup() {
    // Access control middleware
    this.bot.use(async (ctx, next) => {
      if (!this._isAllowed(ctx)) {
        console.warn(
          `[Telegram] Blocked message from user ${ctx.from?.id} (${ctx.from?.username})`
        );
        return; // silently ignore
      }
      await next();
    });

    // Handle text messages
    this.bot.on("message:text", async (ctx) => {
      await this._processSequentially(ctx);
    });

    // Handle errors
    this.bot.catch((err) => {
      console.error("[Telegram] Bot error:", err.message);
    });
  }

  /**
   * Check if the user is allowed.
   */
  _isAllowed(ctx) {
    if (config.telegram.allowedUsers.length === 0) return true;
    const userId = String(ctx.from?.id);
    return config.telegram.allowedUsers.includes(userId);
  }

  /**
   * Process messages sequentially per chat to avoid context interleaving.
   */
  async _processSequentially(ctx) {
    const chatId = String(ctx.chat.id);

    // Chain promises per chat
    const prev = this.chatQueues.get(chatId) || Promise.resolve();
    const current = prev.then(() => this._handleMessage(ctx)).catch(() => {});
    this.chatQueues.set(chatId, current);
  }

  async _handleMessage(ctx) {
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text;

    console.log(
      `[Telegram] Message from ${ctx.from?.username || ctx.from?.id}: ${text.substring(0, 80)}...`
    );

    // Show "typing" indicator
    await ctx.replyWithChatAction("typing");

    // Keep typing indicator alive for long operations
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    try {
      const result = await this.router.route(chatId, text);

      if (!result) return;

      // Send response, splitting if too long for Telegram (4096 char limit)
      await this._sendResponse(ctx, result.response, result.type === "command");
    } catch (err) {
      console.error(`[Telegram] Handle error for chat ${chatId}:`, err.message);
      await ctx.reply(`⚠️ Error: ${err.message}`).catch(() => {});
    } finally {
      clearInterval(typingInterval);
    }
  }

  /**
   * Send response, splitting into chunks if needed.
   * Telegram has a 4096 character limit per message.
   */
  async _sendResponse(ctx, text, isMarkdown = false) {
    if (!text) return;

    const MAX_LEN = 4000; // leave some margin
    const chunks = [];

    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline
      let splitAt = remaining.lastIndexOf("\n", MAX_LEN);
      if (splitAt < MAX_LEN * 0.5) {
        splitAt = MAX_LEN; // no good newline found
      }
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }

    for (const chunk of chunks) {
      try {
        if (isMarkdown) {
          await ctx.reply(chunk, { parse_mode: "Markdown" });
        } else {
          await ctx.reply(chunk);
        }
      } catch {
        // Fallback: send without markdown if parsing fails
        await ctx.reply(chunk).catch(() => {});
      }
    }
  }

  /**
   * Start the bot (long polling).
   */
  async start() {
    console.log("[Telegram] Starting bot...");

    const me = await this.bot.api.getMe();
    console.log(`[Telegram] Bot ready: @${me.username} (${me.id})`);

    await this.bot.start({
      onStart: () => console.log("[Telegram] Polling started."),
      drop_pending_updates: true,
    });
  }

  /**
   * Stop the bot gracefully.
   */
  stop() {
    this.bot.stop();
  }
}
