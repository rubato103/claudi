/**
 * Agent Loader
 *
 * Loads agent role definitions from markdown files (agents/*.md).
 * Each agent provides a system prompt that shapes Claude's behavior.
 * Agents are selected per-chat via /agent use <name>.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export class AgentLoader {
  constructor(agentsDir) {
    this.agentsDir = agentsDir;
    this.agents = new Map();
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
          console.log(`[Agents] Loaded: ${agent.icon || "🤖"} ${agent.name}`);
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
        systemPrompt: content.trim(),
      };
    }

    const frontmatter = {};
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) frontmatter[m[1]] = m[2].trim();
    }

    return {
      name: frontmatter.name || filename.replace(".md", ""),
      description: frontmatter.description || "",
      icon: frontmatter.icon || "🤖",
      systemPrompt: fmMatch[2].trim(),
    };
  }

  /**
   * Get an agent by name.
   */
  get(name) {
    return this.agents.get(name) || null;
  }

  /**
   * List all available agents.
   */
  list() {
    return Array.from(this.agents.values()).map((a) => ({
      name: a.name,
      description: a.description,
      icon: a.icon,
    }));
  }

  /**
   * Build system prompt prefix for an agent.
   */
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
