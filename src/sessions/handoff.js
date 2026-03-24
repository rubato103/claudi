/**
 * Handoff System
 *
 * Manages shared memory that persists context between sessions.
 * Reads/writes data/handoff.json to maintain continuity across
 * conversations and agent switches.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export class HandoffManager {
  /**
   * @param {string} filePath - Path to handoff.json
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this._load();
  }

  /**
   * Load handoff data from disk.
   */
  _load() {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        this.data = JSON.parse(raw);
      } else {
        this.data = this._emptyHandoff();
      }
    } catch (err) {
      console.warn("[Handoff] Failed to load, starting fresh:", err.message);
      this.data = this._emptyHandoff();
    }
  }

  /**
   * Save handoff data to disk.
   */
  _save() {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("[Handoff] Failed to save:", err.message);
    }
  }

  /**
   * Return an empty handoff structure.
   */
  _emptyHandoff() {
    return {
      lastUpdate: null,
      agent: null,
      topic: null,
      keyContext: [],
      pendingForUser: [],
    };
  }

  /**
   * Get the current handoff data.
   * @returns {object}
   */
  get() {
    return this.data;
  }

  /**
   * Update the handoff after a Claude response.
   * @param {object} opts
   * @param {string} opts.agent - Agent name used
   * @param {string} opts.topic - Topic summary
   * @param {string[]} [opts.keyContext] - Key context items
   * @param {string[]} [opts.pendingForUser] - Items pending for user
   */
  update({ agent, topic, keyContext, pendingForUser }) {
    const now = new Date();
    // Format as ISO with KST offset (+09:00)
    const kstOffset = 9 * 60;
    const kstDate = new Date(now.getTime() + kstOffset * 60 * 1000);
    const isoKST =
      kstDate.toISOString().replace("Z", "").replace(/\.\d+$/, "") + "+09:00";

    this.data.lastUpdate = isoKST;

    if (agent !== undefined) this.data.agent = agent;
    if (topic !== undefined) this.data.topic = topic;

    if (keyContext !== undefined) {
      // Merge new context, keeping last 10 items
      if (Array.isArray(keyContext)) {
        const merged = [...(this.data.keyContext || []), ...keyContext];
        this.data.keyContext = merged.slice(-10);
      }
    }

    if (pendingForUser !== undefined) {
      this.data.pendingForUser = pendingForUser;
    }

    this._save();
  }

  /**
   * Clear pending items (e.g., after user has seen them).
   */
  clearPending() {
    this.data.pendingForUser = [];
    this._save();
  }

  /**
   * Build a prompt prefix from handoff context.
   * Returns empty string if no handoff data exists.
   * @returns {string}
   */
  buildPromptPrefix() {
    if (!this.data || !this.data.lastUpdate) return "";

    const parts = ["[Handoff — previous session context]"];

    if (this.data.agent) {
      parts.push(`Last agent: ${this.data.agent}`);
    }
    if (this.data.topic) {
      parts.push(`Topic: ${this.data.topic}`);
    }
    if (this.data.keyContext?.length) {
      parts.push(`Key context:\n${this.data.keyContext.map((c) => `  - ${c}`).join("\n")}`);
    }
    if (this.data.pendingForUser?.length) {
      parts.push(
        `Pending for user:\n${this.data.pendingForUser.map((p) => `  - ${p}`).join("\n")}`
      );
    }
    parts.push(`Last update: ${this.data.lastUpdate}`);
    parts.push("[End of handoff context]\n\n");

    return parts.join("\n") + "\n";
  }

  /**
   * Extract a topic summary from a message (simple heuristic).
   * Takes the first sentence or first 60 characters.
   * @param {string} message
   * @returns {string}
   */
  static extractTopic(message) {
    if (!message) return "general";
    // Remove system prompt prefixes
    const cleaned = message
      .replace(/\[System[^\]]*\][\s\S]*?\[End[^\]]*\]\s*/g, "")
      .trim();
    if (!cleaned) return "general";

    // Take first sentence or first 60 chars
    const firstSentence = cleaned.match(/^[^.!?\n]+[.!?]?/);
    const summary = firstSentence ? firstSentence[0] : cleaned.substring(0, 60);
    return summary.trim() || "general";
  }
}
