/**
 * Intent Router
 *
 * Thin wrapper that delegates intent detection to AgentLoader.
 * Agent triggers are defined in agents/*.md frontmatter — no hardcoded patterns.
 *
 * To add a new agent with auto-routing:
 *   1. Create agents/myagent.md
 *   2. Add "triggers: keyword1,keyword2,키워드" to frontmatter
 *   3. Restart — auto-routing picks it up automatically
 */

/**
 * Detect intent using the agentLoader's trigger system.
 * @param {import('../agents/agent-loader.js').AgentLoader} agentLoader
 * @param {string} message
 * @returns {string|null} Agent name or null for default
 */
export function detectIntent(agentLoader, message) {
  if (!agentLoader) return null;
  return agentLoader.detectIntent(message);
}
