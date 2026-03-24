/**
 * claud.i Configuration
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    allowedUsers: process.env.TELEGRAM_ALLOWED_USERS
      ? process.env.TELEGRAM_ALLOWED_USERS.split(",").map((id) => id.trim())
      : [],
  },
  claude: {
    path: process.env.CLAUDE_PATH || "claude",
  },
  sessions: {
    dir: resolve(process.env.SESSIONS_DIR || `${ROOT_DIR}/data`),
    idleTimeoutMinutes: parseInt(process.env.SESSION_IDLE_TIMEOUT || "30", 10),
    maxConcurrent: parseInt(process.env.MAX_SESSIONS || "5", 10),
  },
  webhook: {
    enabled: process.env.WEBHOOK_ENABLED !== "false",
    port: parseInt(process.env.WEBHOOK_PORT || "3000", 10),
  },
  skills: {
    dir: resolve(process.env.SKILLS_DIR || `${ROOT_DIR}/skills`),
  },
  agents: {
    dir: resolve(process.env.AGENTS_DIR || `${ROOT_DIR}/agents`),
  },
};

export function validateConfig() {
  if (!config.telegram.token) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN is required");
    console.error("  Get one from @BotFather on Telegram");
    process.exit(1);
  }
  if (config.telegram.allowedUsers.length === 0) {
    console.warn(
      "WARNING: TELEGRAM_ALLOWED_USERS is empty — bot will accept messages from ANYONE"
    );
  }
}

export default config;
