/**
 * Telegram Bot
 *
 * Handles Telegram Bot API via grammY.
 * Implements access control, message queuing, streaming responses,
 * and file/image/voice reception.
 */

import { Bot, InputFile } from "grammy";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import config from "../config.js";

export class TelegramBot {
  constructor(router) {
    this.router = router;
    this.bot = new Bot(config.telegram.token);
    /** @type {Map<string, Promise>} per-chat sequential processing */
    this.chatQueues = new Map();
    this.uploadsDir = resolve(config.sessions.dir, "uploads");
    mkdirSync(this.uploadsDir, { recursive: true });

    this._setup();
  }

  _setup() {
    // Access control middleware
    this.bot.use(async (ctx, next) => {
      if (!this._isAllowed(ctx)) {
        console.warn(
          `[Telegram] Blocked message from user ${ctx.from?.id} (${ctx.from?.username})`
        );
        return;
      }
      await next();
    });

    // Handle text messages
    this.bot.on("message:text", (ctx) => this._processSequentially(ctx));

    // Handle photos
    this.bot.on("message:photo", (ctx) => this._processSequentially(ctx));

    // Handle documents (files)
    this.bot.on("message:document", (ctx) => this._processSequentially(ctx));

    // Handle voice messages
    this.bot.on("message:voice", (ctx) => this._processSequentially(ctx));

    this.bot.catch((err) => {
      console.error("[Telegram] Bot error:", err.message);
    });
  }

  _isAllowed(ctx) {
    if (config.telegram.allowedUsers.length === 0) return true;
    const userId = String(ctx.from?.id);
    return config.telegram.allowedUsers.includes(userId);
  }

  async _processSequentially(ctx) {
    const chatId = String(ctx.chat.id);
    const prev = this.chatQueues.get(chatId) || Promise.resolve();
    const current = prev.then(() => this._handleMessage(ctx)).catch(() => {});
    this.chatQueues.set(chatId, current);
  }

  /**
   * Download a Telegram file to local disk.
   * Returns the local file path.
   */
  async _downloadFile(fileId, filename) {
    const file = await this.bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;

    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const localPath = resolve(this.uploadsDir, `${Date.now()}_${filename}`);
    writeFileSync(localPath, buffer);

    return localPath;
  }

  async _handleMessage(ctx) {
    const chatId = String(ctx.chat.id);
    let text = ctx.message.text || ctx.message.caption || "";
    const files = [];

    // Handle photo
    if (ctx.message.photo?.length) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // highest res
      const path = await this._downloadFile(photo.file_id, "photo.jpg");
      files.push(path);
      if (!text) text = "Analyze this image.";
      console.log(`[Telegram] Photo received from ${ctx.from?.username || ctx.from?.id}`);
    }

    // Handle document
    if (ctx.message.document) {
      const doc = ctx.message.document;
      const path = await this._downloadFile(
        doc.file_id,
        doc.file_name || "file"
      );
      files.push(path);
      if (!text) text = `Analyze this file: ${doc.file_name || "file"}`;
      console.log(`[Telegram] Document received: ${doc.file_name}`);
    }

    // Handle voice
    if (ctx.message.voice) {
      const voice = ctx.message.voice;
      const path = await this._downloadFile(voice.file_id, "voice.ogg");
      files.push(path);
      if (!text) text = "Transcribe this voice message.";
      console.log(`[Telegram] Voice message received`);
    }

    if (!text && files.length === 0) return;

    console.log(
      `[Telegram] Message from ${ctx.from?.username || ctx.from?.id}: ${text.substring(0, 80)}`
    );

    await ctx.replyWithChatAction("typing");

    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    try {
      const result = await this.router.route(chatId, text, {
        files,
        onChunk: this._createStreamHandler(ctx),
      });

      if (!result) return;

      // If streaming was used, the message is already sent progressively.
      // Send final version.
      if (result.streamMessageId) {
        await this._editMessage(ctx, result.streamMessageId, result.response);
      } else {
        await this._sendResponse(
          ctx,
          result.response,
          result.type === "command"
        );
      }
    } catch (err) {
      console.error(`[Telegram] Handle error for chat ${chatId}:`, err.message);
      await ctx.reply(`Error: ${err.message}`).catch(() => {});
    } finally {
      clearInterval(typingInterval);
    }
  }

  /**
   * Create a streaming handler that progressively updates a Telegram message.
   */
  _createStreamHandler(ctx) {
    let messageId = null;
    let lastUpdate = 0;
    let lastText = "";
    const UPDATE_INTERVAL = 2000; // update every 2 seconds

    return async (textSoFar) => {
      const now = Date.now();
      // Throttle updates
      if (now - lastUpdate < UPDATE_INTERVAL) return;
      // Skip if text hasn't changed meaningfully
      if (textSoFar.length - lastText.length < 20) return;

      lastUpdate = now;
      lastText = textSoFar;

      const display =
        textSoFar.length > 4000
          ? textSoFar.substring(textSoFar.length - 4000)
          : textSoFar;

      try {
        if (!messageId) {
          const sent = await ctx.reply(display + " ...");
          messageId = sent.message_id;
        } else {
          await ctx.api.editMessageText(
            ctx.chat.id,
            messageId,
            display + " ..."
          );
        }
      } catch {
        // Ignore edit failures (message not modified, etc)
      }
    };
  }

  async _editMessage(ctx, messageId, text) {
    try {
      const display = text.length > 4000 ? text.substring(0, 4000) : text;
      await ctx.api.editMessageText(ctx.chat.id, messageId, display);
    } catch {
      // If edit fails, send as new message
      await this._sendResponse(ctx, text);
    }
  }

  async _sendResponse(ctx, text, isMarkdown = false) {
    if (!text) return;

    const MAX_LEN = 4000;
    const chunks = [];

    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", MAX_LEN);
      if (splitAt < MAX_LEN * 0.5) splitAt = MAX_LEN;
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
        await ctx.reply(chunk).catch(() => {});
      }
    }
  }

  /**
   * Send a message to a specific chat (used by cron/webhook).
   */
  async sendToChat(chatId, text) {
    await this._sendResponseToChat(chatId, text);
  }

  async _sendResponseToChat(chatId, text) {
    if (!text) return;
    const MAX_LEN = 4000;
    let remaining = text;
    while (remaining.length > 0) {
      const chunk =
        remaining.length <= MAX_LEN
          ? remaining
          : remaining.substring(
              0,
              remaining.lastIndexOf("\n", MAX_LEN) || MAX_LEN
            );
      remaining = remaining.substring(chunk.length).trimStart();
      try {
        await this.bot.api.sendMessage(chatId, chunk);
      } catch (err) {
        console.error(`[Telegram] Failed to send to ${chatId}:`, err.message);
        break;
      }
    }
  }

  async start() {
    console.log("[Telegram] Starting bot...");
    const me = await this.bot.api.getMe();
    console.log(`[Telegram] Bot ready: @${me.username} (${me.id})`);

    await this.bot.start({
      onStart: () => console.log("[Telegram] Polling started."),
      drop_pending_updates: true,
    });
  }

  stop() {
    this.bot.stop();
  }
}
