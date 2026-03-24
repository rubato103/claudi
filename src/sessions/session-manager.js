/**
 * Session Manager
 *
 * Maps Telegram chats to Claude Code sessions.
 * Handles session lifecycle: create, route, cleanup.
 */

import { mkdirSync } from "fs";
import config from "../config.js";
import { ClaudeProcess } from "./claude-process.js";
import { SessionStore } from "./session-store.js";

export class SessionManager {
  constructor() {
    mkdirSync(config.sessions.dir, { recursive: true });
    this.store = new SessionStore(config.sessions.dir);
    /** @type {Map<string, ClaudeProcess>} */
    this.processes = new Map();
    this._startCleanupTimer();
  }

  /**
   * Get or create a session for a given context key.
   * Context key format: "telegram:<chatId>" or "telegram:<chatId>:<topic>"
   */
  getSession(contextKey, workdir) {
    if (this.processes.has(contextKey)) {
      return this.processes.get(contextKey);
    }

    // Check max sessions
    if (this.processes.size >= config.sessions.maxConcurrent) {
      // Evict oldest idle session
      const evicted = this._evictIdlest();
      if (!evicted) {
        throw new Error(
          `Maximum sessions (${config.sessions.maxConcurrent}) reached. Try again later.`
        );
      }
    }

    // Restore or create session
    const saved = this.store.get(contextKey);
    const session = new ClaudeProcess(contextKey, workdir);
    if (saved?.resumeSessionId) {
      session.resumeSessionId = saved.resumeSessionId;
    }

    this.processes.set(contextKey, session);
    return session;
  }

  /**
   * Send a message in the given context, return Claude's response.
   * @param {string} contextKey
   * @param {string} message
   * @param {string} [workdir]
   * @param {object} [opts]
   * @param {function} [opts.onChunk] - Streaming callback: (textSoFar) => void
   * @param {string[]} [opts.files] - File paths to attach
   */
  async sendMessage(contextKey, message, workdir, opts = {}) {
    const session = this.getSession(contextKey, workdir);

    try {
      const response = await session.send(message, opts);

      // Persist session state
      this.store.set(contextKey, {
        resumeSessionId: session.resumeSessionId,
        workdir: session.workdir,
        lastActivity: session.lastActivity,
      });

      return response;
    } catch (err) {
      // On failure, don't destroy session — let user retry
      throw err;
    }
  }

  /**
   * Reset a session (clear conversation history).
   */
  resetSession(contextKey) {
    const session = this.processes.get(contextKey);
    if (session) {
      session.kill();
      this.processes.delete(contextKey);
    }
    this.store.delete(contextKey);
  }

  /**
   * List all active sessions.
   */
  listSessions() {
    const sessions = [];
    for (const [key, proc] of this.processes) {
      sessions.push({
        key,
        alive: proc.alive,
        lastActivity: new Date(proc.lastActivity).toISOString(),
        idle: proc.isIdle(),
        resumeSessionId: proc.resumeSessionId || null,
      });
    }
    return sessions;
  }

  /**
   * Evict the most idle session. Returns true if one was evicted.
   */
  _evictIdlest() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [key, proc] of this.processes) {
      if (!proc.alive && proc.lastActivity < oldestTime) {
        oldest = key;
        oldestTime = proc.lastActivity;
      }
    }

    // If no inactive session, evict the longest-idle active one
    if (!oldest) {
      for (const [key, proc] of this.processes) {
        if (proc.lastActivity < oldestTime) {
          oldest = key;
          oldestTime = proc.lastActivity;
        }
      }
    }

    if (oldest) {
      const proc = this.processes.get(oldest);
      proc.kill();
      this.processes.delete(oldest);
      console.log(`[SessionManager] Evicted idle session: ${oldest}`);
      return true;
    }
    return false;
  }

  /**
   * Periodic cleanup of idle sessions.
   */
  _startCleanupTimer() {
    this._cleanupInterval = setInterval(() => {
      for (const [key, proc] of this.processes) {
        if (proc.isIdle() && !proc.alive) {
          console.log(`[SessionManager] Cleaning up idle session: ${key}`);
          this.processes.delete(key);
        }
      }
    }, 60_000); // check every minute
  }

  /**
   * Shutdown all sessions gracefully.
   */
  shutdown() {
    clearInterval(this._cleanupInterval);
    for (const [key, proc] of this.processes) {
      proc.kill();
    }
    this.processes.clear();
    this.store.close();
    console.log("[SessionManager] All sessions closed.");
  }
}
