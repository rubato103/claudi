/**
 * Agent Loader
 *
 * Loads agent role definitions from markdown files (agents/*.md).
 * Each agent provides a system prompt and optional trigger keywords
 * for auto-routing. No hardcoded agents — everything from files.
 *
 * Frontmatter fields:
 *   name:        Agent identifier
 *   description: One-line description
 *   icon:        Emoji icon
 *   triggers:    Comma-separated keywords for auto-routing
 *   default:     If "true", this agent is used when no intent matches
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export class AgentLoader {
  constructor(agentsDir) {
    this.agentsDir = agentsDir;
    this.agents = new Map();
    this.defaultAgent = null;
    this._load();
  }

  _load() {
    if (!existsSync(this.agentsDir)) return;

    const files = readdirSync(this.agentsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      try {
        const content = readFileSync(join(this.agentsDir, file), "utf-8");
        const agent = this._parse(content, file);
        if (agent) {
          this.agents.set(agent.name, agent);
          if (agent.isDefault) this.defaultAgent = agent.name;
          const triggerCount = agent.triggers.length;
          console.log(
            `[Agents] Loaded: ${agent.icon} ${agent.name}` +
              (triggerCount ? ` (${triggerCount} triggers)` : "") +
              (agent.isDefault ? " [default]" : "")
          );
        }
      } catch (err) {
        console.warn(`[Agents] Failed to load ${file}:`, err.message);
      }
    }
    console.log(`[Agents] ${this.agents.size} agents loaded.`);
  }

  _parse(content, filename) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
      return {
        name: filename.replace(".md", ""),
        description: "",
        icon: "🤖",
        triggers: [],
        isDefault: false,
        systemPrompt: content.trim(),
      };
    }

    const frontmatter = {};
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) frontmatter[m[1]] = m[2].trim();
    }

    // Parse triggers from comma-separated string
    const triggers = frontmatter.triggers
      ? frontmatter.triggers
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];

    return {
      name: frontmatter.name || filename.replace(".md", ""),
      description: frontmatter.description || "",
      icon: frontmatter.icon || "🤖",
      triggers,
      isDefault: frontmatter.default === "true",
      systemPrompt: fmMatch[2].trim(),
    };
  }

  get(name) {
    return this.agents.get(name) || null;
  }

  /**
   * Get the default agent name (if any).
   */
  getDefaultName() {
    return this.defaultAgent;
  }

  list() {
    return Array.from(this.agents.values()).map((a) => ({
      name: a.name,
      description: a.description,
      icon: a.icon,
      triggers: a.triggers,
      isDefault: a.isDefault,
    }));
  }

  /**
   * Detect which agent should handle a message based on triggers.
   * Returns agent name or null.
   */
  detectIntent(message) {
    if (!message || typeof message !== "string") return null;

    const msgLower = message.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [name, agent] of this.agents) {
      if (agent.isDefault) continue; // skip default agent in matching
      let score = 0;

      for (const trigger of agent.triggers) {
        if (msgLower.includes(trigger)) {
          // Longer triggers get higher scores (more specific)
          score += trigger.length;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = name;
      }
    }

    // Minimum threshold to avoid false positives
    return bestScore >= 2 ? bestMatch : null;
  }

  buildPromptPrefix(agentName) {
    const agent = this.agents.get(agentName);
    if (!agent) return "";
    return (
      `[System — You are the "${agent.name}" agent]\n\n` +
      agent.systemPrompt +
      "\n\n[End of agent instructions]\n\n"
    );
  }
}
