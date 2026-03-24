/**
 * Skill Loader
 *
 * Loads skill definitions from markdown files (skills/*.md).
 * Skills are injected into the Claude Code prompt as system context,
 * similar to how OpenClaw uses SKILL.md files.
 *
 * Skill file format:
 * ---
 * name: skill-name
 * description: one-line description
 * trigger: keyword or pattern that activates this skill
 * always: false          # if true, always include in prompt
 * ---
 * (markdown body — instructions for Claude)
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";

export class SkillLoader {
  constructor(skillsDir) {
    this.skillsDir = skillsDir;
    this.skills = [];
    this._load();
  }

  _load() {
    if (!existsSync(this.skillsDir)) return;

    const files = readdirSync(this.skillsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      try {
        const content = readFileSync(join(this.skillsDir, file), "utf-8");
        const skill = this._parse(content, file);
        if (skill) {
          this.skills.push(skill);
          console.log(`[Skills] Loaded: ${skill.name}`);
        }
      } catch (err) {
        console.warn(`[Skills] Failed to load ${file}:`, err.message);
      }
    }
    console.log(`[Skills] ${this.skills.length} skills loaded.`);
  }

  _parse(content, filename) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
      return {
        name: filename.replace(".md", ""),
        description: "",
        trigger: null,
        always: false,
        body: content,
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
      trigger: frontmatter.trigger || null,
      always: frontmatter.always === "true",
      body: fmMatch[2].trim(),
    };
  }

  /**
   * Get skills relevant to a message.
   * Returns always-on skills + trigger-matched skills.
   */
  getRelevantSkills(message) {
    const relevant = [];
    const msgLower = message.toLowerCase();

    for (const skill of this.skills) {
      if (skill.always) {
        relevant.push(skill);
        continue;
      }
      if (skill.trigger) {
        const triggers = skill.trigger.split(",").map((t) => t.trim().toLowerCase());
        if (triggers.some((t) => msgLower.includes(t))) {
          relevant.push(skill);
        }
      }
    }
    return relevant;
  }

  /**
   * Build a prompt prefix from relevant skills.
   */
  buildSkillContext(message) {
    const skills = this.getRelevantSkills(message);
    if (skills.length === 0) return "";

    const sections = skills.map(
      (s) => `## Skill: ${s.name}\n${s.description ? `> ${s.description}\n` : ""}\n${s.body}`
    );

    return (
      "[System context — active skills]\n\n" +
      sections.join("\n\n---\n\n") +
      "\n\n[End of skills context]\n\n"
    );
  }

  /**
   * List all loaded skills.
   */
  list() {
    return this.skills.map((s) => ({
      name: s.name,
      description: s.description,
      trigger: s.trigger,
      always: s.always,
    }));
  }
}
